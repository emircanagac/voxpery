use sqlx::PgPool;
use uuid::Uuid;

use crate::{errors::AppError, services::audit};

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct AutoModRule {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub trigger_type: String,
    pub pattern: Option<String>,
    pub mention_limit: Option<i32>,
    pub enabled: bool,
    pub exempt_role_ids: Vec<Uuid>,
    pub exempt_channel_ids: Vec<Uuid>,
    pub created_by: Option<Uuid>,
    pub updated_by: Option<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoModMatch {
    pub rule_id: Uuid,
    pub rule_name: String,
    pub trigger_type: String,
    pub matched_value: Option<String>,
}

pub fn content_preview(content: &str) -> (String, bool) {
    let mut out = String::new();
    let mut chars = content.chars();
    for _ in 0..160 {
        let Some(ch) = chars.next() else {
            return (out, false);
        };
        out.push(ch);
    }
    (out, chars.next().is_some())
}

fn has_link(content: &str) -> bool {
    content.contains("http://")
        || content.contains("https://")
        || content.contains("www.")
        || content.contains(".com")
        || content.contains(".net")
        || content.contains(".org")
}

fn has_invite_link(content: &str) -> bool {
    content.contains("discord.gg/")
        || content.contains("discord.com/invite/")
        || content.contains("discordapp.com/invite/")
        || content.contains("/invite/")
}

fn is_automod_ignored_char(ch: char) -> bool {
    ch.is_control()
        || matches!(
            ch,
            '\u{00AD}'
                | '\u{034F}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
        )
}

fn normalize_automod_text(input: &str) -> String {
    input
        .chars()
        .filter(|ch| !is_automod_ignored_char(*ch))
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_mention_boundary_char(ch: Option<char>) -> bool {
    match ch {
        None => true,
        Some(c) => !(c.is_ascii_alphanumeric() || c == '_' || c == '.'),
    }
}

pub fn mention_count(content: &str) -> usize {
    let mut count = 0usize;
    let mut idx = 0usize;
    while idx < content.len() {
        let ch = content[idx..]
            .chars()
            .next()
            .expect("valid UTF-8 character boundary");
        let ch_len = ch.len_utf8();

        if ch == '@' {
            let prev_char = content[..idx].chars().next_back();
            let next_char = content[idx + ch_len..].chars().next();
            if is_mention_boundary_char(prev_char)
                && next_char
                    .map(|c| c.is_ascii_alphanumeric() || c == '_')
                    .unwrap_or(false)
            {
                count += 1;
            }
        }

        idx += ch_len;
    }
    count
}

fn evaluate_rule(rule: &AutoModRule, content: &str) -> Option<AutoModMatch> {
    let normalized_content = normalize_automod_text(content);
    match rule.trigger_type.as_str() {
        "blocked_keyword" => {
            let pattern = rule.pattern.as_deref()?.trim();
            if pattern.is_empty() {
                return None;
            }
            let normalized_pattern = normalize_automod_text(pattern);
            if !normalized_pattern.is_empty() && normalized_content.contains(&normalized_pattern) {
                Some(AutoModMatch {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    trigger_type: rule.trigger_type.clone(),
                    matched_value: Some(pattern.to_string()),
                })
            } else {
                None
            }
        }
        "invite_filter" if has_invite_link(&normalized_content) => Some(AutoModMatch {
            rule_id: rule.id,
            rule_name: rule.name.clone(),
            trigger_type: rule.trigger_type.clone(),
            matched_value: Some("invite_link".into()),
        }),
        "link_filter" if has_link(&normalized_content) => Some(AutoModMatch {
            rule_id: rule.id,
            rule_name: rule.name.clone(),
            trigger_type: rule.trigger_type.clone(),
            matched_value: Some("link".into()),
        }),
        "mention_spam" => {
            let limit = rule.mention_limit.unwrap_or(5).max(1) as usize;
            let mentions = mention_count(&normalized_content);
            if mentions >= limit {
                Some(AutoModMatch {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    trigger_type: rule.trigger_type.clone(),
                    matched_value: Some(mentions.to_string()),
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

pub async fn evaluate_message(
    db: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    content: &str,
) -> Result<Option<AutoModMatch>, AppError> {
    if content.trim().is_empty() {
        return Ok(None);
    }

    let rules = sqlx::query_as::<_, AutoModRule>(
        r#"SELECT id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                  exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at
           FROM server_automod_rules
           WHERE server_id = $1
             AND enabled = TRUE
             AND NOT ($2 = ANY(exempt_channel_ids))
             AND NOT EXISTS (
                 SELECT 1
                 FROM server_member_roles smr
                 WHERE smr.server_id = $1
                   AND smr.user_id = $3
                   AND smr.role_id = ANY(exempt_role_ids)
             )
           ORDER BY created_at ASC"#,
    )
    .bind(server_id)
    .bind(channel_id)
    .bind(user_id)
    .fetch_all(db)
    .await?;

    Ok(rules.iter().find_map(|rule| evaluate_rule(rule, content)))
}

pub async fn log_blocked_message(
    db: &PgPool,
    user_id: Uuid,
    server_id: Uuid,
    channel_id: Uuid,
    matched: &AutoModMatch,
    content: &str,
) -> Result<(), AppError> {
    let (preview, truncated) = content_preview(content);
    audit::log(
        db,
        user_id,
        Some(server_id),
        "automod_message_block",
        "message",
        None,
        Some(serde_json::json!({
            "rule_id": matched.rule_id,
            "rule_name": matched.rule_name,
            "trigger_type": matched.trigger_type,
            "matched_value": matched.matched_value,
            "channel_id": channel_id,
            "content_preview": preview,
            "content_truncated": truncated
        })),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocked_keyword_rule(pattern: &str) -> AutoModRule {
        AutoModRule {
            id: Uuid::new_v4(),
            server_id: Uuid::new_v4(),
            name: "Blocked keyword".into(),
            trigger_type: "blocked_keyword".into(),
            pattern: Some(pattern.into()),
            mention_limit: None,
            enabled: true,
            exempt_role_ids: vec![],
            exempt_channel_ids: vec![],
            created_by: None,
            updated_by: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn mention_count_ignores_email_like_text() {
        assert_eq!(mention_count("hello @one @two test@example.com"), 2);
    }

    #[test]
    fn blocked_keyword_matches_zero_width_bypass() {
        let rule = blocked_keyword_rule("badword");
        assert!(evaluate_rule(&rule, "ba\u{200B}dword").is_some());
    }

    #[test]
    fn blocked_keyword_matches_rtl_override_bypass() {
        let rule = blocked_keyword_rule("badword");
        assert!(evaluate_rule(&rule, "bad\u{202E}word").is_some());
    }

    #[test]
    fn invite_filter_matches_zero_width_bypass() {
        let mut rule = blocked_keyword_rule("");
        rule.trigger_type = "invite_filter".into();
        assert!(evaluate_rule(&rule, "discord.\u{200B}gg/example").is_some());
    }

    #[test]
    fn link_filter_matches_zero_width_bypass() {
        let mut rule = blocked_keyword_rule("");
        rule.trigger_type = "link_filter".into();
        assert!(evaluate_rule(&rule, "https://exa\u{200B}mple.com").is_some());
    }

    #[test]
    fn content_preview_reports_truncation() {
        let input = "a".repeat(161);
        let (preview, truncated) = content_preview(&input);
        assert_eq!(preview.len(), 160);
        assert!(truncated);
    }
}
