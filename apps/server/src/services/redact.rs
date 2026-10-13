//! Log-safe forms of personal identifiers.

use std::fmt;
use uuid::Uuid;

/// The first eight hex digits of an id: enough to follow one session through the logs,
/// not enough to look the account up. Use it in log lines instead of the full id.
pub struct ShortId(pub Uuid);

impl fmt::Display for ShortId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let simple = self.0.simple().to_string();
        write!(f, "{}…", &simple[..8])
    }
}

#[cfg(test)]
mod tests {
    use super::ShortId;
    use uuid::Uuid;

    #[test]
    fn shows_only_the_id_prefix() {
        let id = Uuid::parse_str("3f2a9c1b-7d4e-4f00-9a11-0123456789ab").unwrap();
        assert_eq!(ShortId(id).to_string(), "3f2a9c1b…");
    }
}
