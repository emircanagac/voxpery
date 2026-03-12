use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use lettre::transport::smtp::authentication::Credentials;
use lettre::message::header::ContentType;
use crate::errors::AppError;

pub async fn send_password_reset_email(
    to_email: &str,
    reset_link: &str,
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
        .subject("Reset your Voxpery password")
        .header(ContentType::TEXT_HTML)
        .body(format!(
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
        ))
        .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

    let creds = Credentials::new(smtp_user.to_string(), smtp_pass.to_string());

    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_host)
        .map_err(|e| AppError::Internal(format!("Failed to configure SMTP transport: {}", e)))?
        .credentials(creds)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send email: {}", e)))?;

    Ok(())
}
