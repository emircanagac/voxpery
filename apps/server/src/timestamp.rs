//! A UTC point in time for database rows and API responses.
//!
//! It wraps `time::OffsetDateTime` (always UTC) and keeps the JSON form the API has always
//! used: RFC 3339 with a `Z` suffix and 0, 3, 6 or 9 fraction digits (as many as the value
//! needs, in groups of three), so clients see the same strings as before.

use std::fmt;
use std::ops::{Add, Sub};

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime, UtcOffset};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, sqlx::Type)]
#[sqlx(transparent)]
pub struct Timestamp(OffsetDateTime);

impl Timestamp {
    pub fn now() -> Self {
        Self(OffsetDateTime::now_utc())
    }

    /// Whole seconds since the Unix epoch.
    pub fn timestamp(&self) -> i64 {
        self.0.unix_timestamp()
    }

    pub fn from_unix_timestamp(seconds: i64) -> Option<Self> {
        OffsetDateTime::from_unix_timestamp(seconds).ok().map(Self)
    }

    /// Parses RFC 3339 with any offset and keeps the instant in UTC.
    pub fn parse_rfc3339(value: &str) -> Result<Self, time::error::Parse> {
        OffsetDateTime::parse(value, &Rfc3339).map(Self::from)
    }

    /// RFC 3339 with a `+00:00` offset, for places that are not JSON fields.
    pub fn to_rfc3339(&self) -> String {
        format!("{}+00:00", self.iso_without_offset())
    }

    pub fn year(&self) -> i32 {
        self.0.year()
    }

    pub fn month(&self) -> u8 {
        u8::from(self.0.month())
    }

    pub fn inner(&self) -> OffsetDateTime {
        self.0
    }

    fn iso_without_offset(&self) -> String {
        let t = self.0;
        let nanos = t.nanosecond();
        let fraction = if nanos == 0 {
            String::new()
        } else if nanos.is_multiple_of(1_000_000) {
            format!(".{:03}", nanos / 1_000_000)
        } else if nanos.is_multiple_of(1_000) {
            format!(".{:06}", nanos / 1_000)
        } else {
            format!(".{:09}", nanos)
        };
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}",
            t.year(),
            u8::from(t.month()),
            t.day(),
            t.hour(),
            t.minute(),
            t.second(),
            fraction
        )
    }
}

impl From<OffsetDateTime> for Timestamp {
    fn from(value: OffsetDateTime) -> Self {
        Self(value.to_offset(UtcOffset::UTC))
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}Z", self.iso_without_offset())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse_rfc3339(&value).map_err(de::Error::custom)
    }
}

impl Add<Duration> for Timestamp {
    type Output = Self;
    fn add(self, rhs: Duration) -> Self {
        Self(self.0 + rhs)
    }
}

impl Sub<Duration> for Timestamp {
    type Output = Self;
    fn sub(self, rhs: Duration) -> Self {
        Self(self.0 - rhs)
    }
}

impl Sub for Timestamp {
    type Output = Duration;
    fn sub(self, rhs: Self) -> Duration {
        self.0 - rhs.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(nanos: u32) -> Timestamp {
        let base = OffsetDateTime::from_unix_timestamp(1_763_712_000).unwrap();
        Timestamp(base.replace_nanosecond(nanos).unwrap())
    }

    #[test]
    fn json_keeps_the_previous_rfc3339_form() {
        assert_eq!(
            serde_json::to_string(&at(0)).unwrap(),
            "\"2025-11-21T08:00:00Z\""
        );
        assert_eq!(
            serde_json::to_string(&at(120_000_000)).unwrap(),
            "\"2025-11-21T08:00:00.120Z\""
        );
        assert_eq!(
            serde_json::to_string(&at(123_450_000)).unwrap(),
            "\"2025-11-21T08:00:00.123450Z\""
        );
        assert_eq!(
            serde_json::to_string(&at(123_456_789)).unwrap(),
            "\"2025-11-21T08:00:00.123456789Z\""
        );
        assert_eq!(
            at(120_000_000).to_rfc3339(),
            "2025-11-21T08:00:00.120+00:00"
        );
    }

    #[test]
    fn parses_any_offset_into_utc() {
        let parsed: Timestamp = serde_json::from_str("\"2025-11-21T11:00:00.120+03:00\"").unwrap();
        assert_eq!(parsed, at(120_000_000));
        assert!(serde_json::from_str::<Timestamp>("\"not a date\"").is_err());
    }

    #[test]
    fn arithmetic_matches_durations() {
        let start = at(0);
        assert_eq!((start + Duration::hours(2)) - start, Duration::hours(2));
        assert_eq!(
            (start - Duration::minutes(5)).timestamp(),
            start.timestamp() - 300
        );
    }
}
