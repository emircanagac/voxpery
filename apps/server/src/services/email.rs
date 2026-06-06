use crate::errors::AppError;
use lettre::Message;
use lettre::message::header::ContentType;
use lettre::transport::smtp::{
    authentication::{Credentials, DEFAULT_MECHANISMS},
    client::{AsyncSmtpConnection, TlsParameters},
    extension::ClientId,
};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};

const SMTP_SUBMISSION_PORT: u16 = 587;
const SMTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

fn resolve_ipv4_smtp_addr(smtp_host: &str, port: u16) -> Result<SocketAddr, AppError> {
    (smtp_host, port)
        .to_socket_addrs()
        .map_err(|e| AppError::Internal(format!("Failed to resolve SMTP host: {}", e)))?
        .find(|addr| addr.is_ipv4())
        .ok_or_else(|| AppError::Internal("SMTP host did not resolve to an IPv4 address".into()))
}

async fn send_html_email(
    to_email: &str,
    subject: &str,
    html_body: String,
    smtp_host: &str,
    smtp_user: &str,
    smtp_pass: &str,
) -> Result<(), AppError> {
    let from_addr = format!("Voxpery <{}>", smtp_user)
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid from address: {}", e)))?;

    let to_addr = to_email
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid to address: {}", e)))?;

    let email = Message::builder()
        .from(from_addr)
        .to(to_addr)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body)
        .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

    send_message_via_smtp(smtp_host, smtp_user, smtp_pass, email).await?;

    Ok(())
}

async fn send_message_via_smtp(
    smtp_host: &str,
    smtp_user: &str,
    smtp_pass: &str,
    email: Message,
) -> Result<(), AppError> {
    let creds = Credentials::new(smtp_user.to_string(), smtp_pass.to_string());
    let hello_name = ClientId::default();
    let tls_parameters = TlsParameters::new(smtp_host.to_string())
        .map_err(|e| AppError::Internal(format!("Failed to configure SMTP TLS: {}", e)))?;
    let smtp_addr = resolve_ipv4_smtp_addr(smtp_host, SMTP_SUBMISSION_PORT)?;

    let mut conn = AsyncSmtpConnection::connect_tokio1(
        smtp_addr,
        Some(SMTP_CONNECT_TIMEOUT),
        &hello_name,
        None,
        Some(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),
    )
    .await
    .map_err(|e| AppError::Internal(format!("Failed to connect to SMTP server: {}", e)))?;

    conn.starttls(tls_parameters, &hello_name)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start SMTP TLS: {}", e)))?;

    conn.auth(DEFAULT_MECHANISMS, &creds)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to authenticate with SMTP: {}", e)))?;

    let raw = email.formatted();
    conn.send(email.envelope(), &raw)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send email: {}", e)))?;

    if let Err(err) = conn.quit().await {
        tracing::warn!("Failed to close SMTP connection cleanly: {}", err);
    }

    Ok(())
}

pub async fn send_password_reset_email(
    to_email: &str,
    reset_link: &str,
    smtp_host: &str,
    smtp_user: &str,
    smtp_pass: &str,
) -> Result<(), AppError> {
    send_html_email(
        to_email,
        "Reset your Voxpery password",
        format!(
            r#"
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Password Reset Request</h2>
                <p>Hello,</p>
                <p>We received a request to reset your password for your Voxpery account.</p>
                <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
                <a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #89b4fa; color: #1e1e2e; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 16px 0;">Reset Password</a>
                <p style="font-size: 0.9em; color: #666;">If you did not request a password reset, you can safely ignore this email.</p>
                <p>Thanks,<br/>The Voxpery Team</p>
            </div>
            "#,
            reset_link
        ),
        smtp_host,
        smtp_user,
        smtp_pass,
    )
    .await
}

pub async fn send_email_verification_email(
    to_email: &str,
    verify_link: &str,
    smtp_host: &str,
    smtp_user: &str,
    smtp_pass: &str,
) -> Result<(), AppError> {
    send_html_email(
        to_email,
        "Verify your Voxpery email address",
        format!(
            r#"
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Verify Your Email Address</h2>
                <p>Hello,</p>
                <p>Please confirm your email address for your Voxpery account.</p>
                <p>Click the button below to verify this address. This link will expire in 1 hour.</p>
                <a href="{}" style="display: inline-block; padding: 12px 24px; background-color: #89b4fa; color: #1e1e2e; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 16px 0;">Verify Email</a>
                <p style="font-size: 0.9em; color: #666;">If you did not request this change, you can safely ignore this email.</p>
                <p>Thanks,<br/>The Voxpery Team</p>
            </div>
            "#,
            verify_link
        ),
        smtp_host,
        smtp_user,
        smtp_pass,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::resolve_ipv4_smtp_addr;

    #[test]
    fn resolve_ipv4_smtp_addr_accepts_ipv4_literal() {
        let addr = resolve_ipv4_smtp_addr("127.0.0.1", 587).expect("IPv4 literal should resolve");

        assert!(addr.is_ipv4());
        assert_eq!(addr.port(), 587);
    }

    #[test]
    fn resolve_ipv4_smtp_addr_rejects_ipv6_only_literal() {
        let err = resolve_ipv4_smtp_addr("::1", 587).expect_err("IPv6-only literal should fail");

        assert!(err.to_string().contains("IPv4"));
    }
}
