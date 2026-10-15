use std::net::{IpAddr, SocketAddr};

use axum::http::{header::HeaderName, HeaderMap};
use ipnet::IpNet;

const X_FORWARDED_FOR: HeaderName = HeaderName::from_static("x-forwarded-for");
const X_REAL_IP: HeaderName = HeaderName::from_static("x-real-ip");
const CF_CONNECTING_IP: HeaderName = HeaderName::from_static("cf-connecting-ip");

#[derive(Clone, Debug, Default)]
pub struct TrustedProxySet {
    networks: Vec<IpNet>,
}

impl TrustedProxySet {
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        let mut networks = Vec::new();
        for value in raw
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let network = value
                .parse::<IpNet>()
                .or_else(|_| value.parse::<IpAddr>().map(IpNet::from))
                .map_err(|_| {
                    format!("TRUSTED_PROXY_CIDRS contains an invalid IP or CIDR: {value}")
                })?;
            if network.prefix_len() == 0 {
                return Err("TRUSTED_PROXY_CIDRS cannot trust an all-addresses network".into());
            }
            if !networks.contains(&network) {
                networks.push(network);
            }
        }
        Ok(Self { networks })
    }

    pub fn contains(&self, ip: &IpAddr) -> bool {
        let ip = normalize_ip(*ip);
        self.networks.iter().any(|network| network.contains(&ip))
    }

    pub fn is_empty(&self) -> bool {
        self.networks.is_empty()
    }
}

fn normalize_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ipv6) => ipv6
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ipv6)),
        ipv4 => ipv4,
    }
}

fn single_ip_header(headers: &HeaderMap, name: HeaderName) -> Option<IpAddr> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| value.parse::<IpAddr>().ok())
        .map(normalize_ip)
}

/// One hop of a forwarded chain: a bare address, `ip:port` or `[ipv6]:port`.
fn parse_forwarded_hop(hop: &str) -> Option<IpAddr> {
    hop.parse::<IpAddr>()
        .ok()
        .or_else(|| hop.parse::<SocketAddr>().ok().map(|addr| addr.ip()))
}

fn forwarded_for_client_ip(headers: &HeaderMap, trusted: &TrustedProxySet) -> Option<IpAddr> {
    // A proxy may add its own header line instead of extending the first one, so read every
    // line in order as one chain.
    let mut hops = Vec::new();
    for value in headers.get_all(X_FORWARDED_FOR) {
        hops.extend(
            value
                .to_str()
                .ok()?
                .split(',')
                .map(str::trim)
                .filter(|hop| !hop.is_empty()),
        );
    }
    // Walk back from the trusted edge. A hop that is not an address cannot be attributed, so
    // stop there rather than skip it and believe whatever the client wrote further left.
    for hop in hops.iter().rev() {
        let ip = normalize_ip(parse_forwarded_hop(hop)?);
        if !trusted.contains(&ip) {
            return Some(ip);
        }
    }
    None
}

/// Resolve the rate-limit identity for a request. Forwarded headers are ignored
/// unless the direct socket peer belongs to an explicitly configured proxy range.
pub fn resolve_client_ip(
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
    trusted: &TrustedProxySet,
) -> Option<String> {
    let peer_ip = normalize_ip(peer_ip?);
    if !trusted.contains(&peer_ip) {
        return Some(peer_ip.to_string());
    }

    let client_ip = forwarded_for_client_ip(headers, trusted)
        .or_else(|| single_ip_header(headers, X_REAL_IP))
        .or_else(|| single_ip_header(headers, CF_CONNECTING_IP))
        .unwrap_or(peer_ip);
    Some(client_ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(values: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in values {
            headers.insert(*name, HeaderValue::from_static(value));
        }
        headers
    }

    #[test]
    fn parses_exact_ips_and_cidrs_but_rejects_trust_all() {
        let trusted = TrustedProxySet::parse(Some("127.0.0.1, 10.20.0.0/16, ::1/128"))
            .expect("valid proxy ranges");
        assert!(trusted.contains(&"127.0.0.1".parse().unwrap()));
        assert!(trusted.contains(&"10.20.4.8".parse().unwrap()));
        assert!(trusted.contains(&"::ffff:10.20.4.8".parse().unwrap()));
        assert!(!trusted.contains(&"10.21.4.8".parse().unwrap()));
        assert!(TrustedProxySet::parse(Some("0.0.0.0/0")).is_err());
        assert!(TrustedProxySet::parse(Some("::/0")).is_err());
        assert!(TrustedProxySet::parse(Some("not-an-ip")).is_err());
    }

    #[test]
    fn ignores_forwarded_headers_from_untrusted_peers() {
        let trusted = TrustedProxySet::default();
        let headers = headers(&[
            ("x-forwarded-for", "203.0.113.10"),
            ("x-real-ip", "203.0.113.11"),
        ]);
        assert_eq!(
            resolve_client_ip(&headers, Some("127.0.0.1".parse().unwrap()), &trusted).as_deref(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn walks_forwarded_chain_from_the_trusted_edge() {
        let trusted = TrustedProxySet::parse(Some("10.0.0.0/8")).unwrap();
        let headers = headers(&[("x-forwarded-for", "203.0.113.99, 198.51.100.8, 10.20.30.40")]);
        assert_eq!(
            resolve_client_ip(&headers, Some("10.20.30.50".parse().unwrap()), &trusted).as_deref(),
            Some("198.51.100.8")
        );
    }

    #[test]
    fn supports_single_ip_proxy_headers_only_for_trusted_peers() {
        let trusted = TrustedProxySet::parse(Some("172.20.0.0/16")).unwrap();
        let real_ip_headers = headers(&[("x-real-ip", "198.51.100.20")]);
        assert_eq!(
            resolve_client_ip(
                &real_ip_headers,
                Some("172.20.0.2".parse().unwrap()),
                &trusted
            )
            .as_deref(),
            Some("198.51.100.20")
        );

        let cloudflare_headers = headers(&[("cf-connecting-ip", "2001:db8::20")]);
        assert_eq!(
            resolve_client_ip(
                &cloudflare_headers,
                Some("172.20.0.2".parse().unwrap()),
                &trusted
            )
            .as_deref(),
            Some("2001:db8::20")
        );
    }

    #[test]
    fn reads_every_forwarded_header_and_proxy_ports() {
        let trusted = TrustedProxySet::parse(Some("10.0.0.0/8")).unwrap();
        let peer = Some("10.0.0.2".parse().unwrap());
        // The client's own header comes first; the proxy appended a second line.
        let mut split = HeaderMap::new();
        split.append("x-forwarded-for", HeaderValue::from_static("203.0.113.66"));
        split.append(
            "x-forwarded-for",
            HeaderValue::from_static("198.51.100.8, 10.0.0.9"),
        );
        assert_eq!(
            resolve_client_ip(&split, peer, &trusted).as_deref(),
            Some("198.51.100.8")
        );

        let with_ports = headers(&[("x-forwarded-for", "198.51.100.8:51234, [2001:db8::1]:443")]);
        assert_eq!(
            resolve_client_ip(&with_ports, peer, &trusted).as_deref(),
            Some("2001:db8::1")
        );
    }

    #[test]
    fn stops_at_an_unparseable_hop_instead_of_trusting_the_client_side() {
        let trusted = TrustedProxySet::parse(Some("10.0.0.0/8")).unwrap();
        let headers = headers(&[("x-forwarded-for", "203.0.113.66, unknown, 10.0.0.9")]);
        assert_eq!(
            resolve_client_ip(&headers, Some("10.0.0.2".parse().unwrap()), &trusted).as_deref(),
            Some("10.0.0.2"),
            "the spoofable left-hand value must not be used"
        );
    }

    #[test]
    fn malformed_forwarding_falls_back_to_trusted_peer() {
        let trusted = TrustedProxySet::parse(Some("127.0.0.1/32")).unwrap();
        let headers = headers(&[
            ("x-forwarded-for", "invalid"),
            ("x-real-ip", "also-invalid"),
        ]);
        assert_eq!(
            resolve_client_ip(&headers, Some("127.0.0.1".parse().unwrap()), &trusted).as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(resolve_client_ip(&headers, None, &trusted), None);
    }
}
