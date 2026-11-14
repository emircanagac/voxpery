//! Mentions by name in server channel messages. They are stored per message so mention badges
//! do not depend on a client having been connected when the message arrived.

use std::collections::HashSet;

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;
use crate::services::permissions::{Permissions, ServerPermissionSnapshot};

/// A message that names more people than this notifies only the first ones.
pub const MAX_MENTIONS_PER_MESSAGE: usize = 20;

const MIN_USERNAME_LEN: usize = 3;
const MAX_USERNAME_LEN: usize = 32;

/// Lower-cased usernames written as `@name` words, in order, without repeats. A mention is a
/// whole word: `@name` between whitespace or the ends of the text, as the web client highlights
/// it.
pub fn mentioned_usernames(content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for word in content.split_whitespace() {
        let Some(name) = word.strip_prefix('@') else {
            continue;
        };
        if !(MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&name.len())
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        {
            continue;
        }
        let name = name.to_ascii_lowercase();
        if name == "everyone" || name == "here" {
            continue;
        }
        if seen.insert(name.clone()) {
            names.push(name);
            if names.len() == MAX_MENTIONS_PER_MESSAGE {
                break;
            }
        }
    }
    names
}

/// The members a message mentions by name: members of the server who can see the channel,
/// never the author. Read before the message transaction starts.
pub async fn resolve_mentions(
    db: &PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    author_id: Uuid,
    content: &str,
) -> Result<Vec<Uuid>, AppError> {
    let names = mentioned_usernames(content);
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let candidates: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT u.id
           FROM users u
           INNER JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $1
           WHERE lower(u.username) = ANY($2) AND u.id <> $3"#,
    )
    .bind(server_id)
    .bind(&names)
    .bind(author_id)
    .fetch_all(db)
    .await?;
    if candidates.is_empty() {
        return Ok(candidates);
    }
    let snapshot = ServerPermissionSnapshot::load(db, server_id, Some(&candidates)).await?;
    Ok(candidates
        .into_iter()
        .filter(|user_id| {
            snapshot
                .channel_permissions(channel_id, *user_id)
                .contains(Permissions::VIEW_SERVER)
        })
        .collect())
}

/// Replaces the stored mentions of a message, in the transaction that writes the message.
/// `created_at` is the message's own timestamp, so an edit never makes an old mention new.
pub async fn store_mentions(
    tx: &mut Transaction<'_, Postgres>,
    message_id: Uuid,
    channel_id: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    user_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM message_mentions WHERE message_id = $1 AND user_id <> ALL($2)")
        .bind(message_id)
        .bind(user_ids)
        .execute(&mut **tx)
        .await?;
    if user_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"INSERT INTO message_mentions (message_id, user_id, channel_id, created_at)
           SELECT $1, mentioned, $2, $3 FROM UNNEST($4::uuid[]) AS mentioned
           ON CONFLICT (message_id, user_id) DO NOTHING"#,
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(created_at)
    .bind(user_ids)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_whole_word_mentions_once_each() {
        assert_eq!(
            mentioned_usernames("hi @Alice and @bob.smith, also @alice\n@carol_1"),
            vec!["alice", "carol_1"]
        );
    }

    #[test]
    fn ignores_mass_mentions_addresses_and_bad_names() {
        assert!(
            mentioned_usernames("@everyone @here mail@alice.example @ab @b@d x@carol").is_empty()
        );
    }

    #[test]
    fn stops_at_the_mention_limit() {
        let content = (0..40)
            .map(|index| format!("@user{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            mentioned_usernames(&content).len(),
            MAX_MENTIONS_PER_MESSAGE
        );
    }
}
