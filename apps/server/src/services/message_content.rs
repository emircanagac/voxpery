pub const MAX_MESSAGE_CHARACTERS: usize = 4000;

pub fn exceeds_message_limit(content: &str) -> bool {
    content.len() > MAX_MESSAGE_CHARACTERS * 4
        || content.chars().count() > MAX_MESSAGE_CHARACTERS
}

#[cfg(test)]
mod tests {
    use super::exceeds_message_limit;

    #[test]
    fn counts_unicode_characters_instead_of_utf8_bytes() {
        assert!(!exceeds_message_limit(&"😀".repeat(4000)));
        assert!(exceeds_message_limit(&"😀".repeat(4001)));
        assert!(exceeds_message_limit(&"a".repeat(4001)));
    }
}
