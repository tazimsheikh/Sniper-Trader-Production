import nodemailer from 'nodemailer';

/**
 * Sends a 6-digit verification code (OTP) to the specified email address.
 * If SMTP environment variables are not configured, it will log the OTP directly to the 
 * console/terminal output. This is a critical developer-friendly fallback to allow 
 * authentication testing without needing live mail servers.
 *
 * @param email Recipient email address
 * @param otp 6-digit string code
 * @returns boolean indicating successful send or fallback logging
 */
export async function sendOtpEmail(email: string, otp: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || '"Sniper Trader" <noreply@domain.com>';

  console.log(`\n=========================================`);
  console.log(`🔑 SECURITY TERMINAL - GENERATED OTP`);
  console.log(`👉 Target Account:  ${email}`);
  console.log(`👉 Access Code:     ${otp}`);
  console.log(`=========================================\n`);

  if (!host || !user || !pass) {
    console.warn('[Email Service] ⚠️ SMTP environment variables are not fully configured.');
    console.warn('[Email Service] ⚠️ To enable real email delivery, set SMTP_HOST, SMTP_USER, SMTP_PASS in your environment.');
    console.warn('[Email Service] 👉 Fallback activated: Access code was successfully logged above.');
    return true; // Return true so flow doesn't block for local/mock validation
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // True for port 465, false for 587 or others
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: `🔑 Sniper Trader - Verification Code: ${otp}`,
      text: `Your verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you did not request this code, please ignore this email.`,
      html: `
        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; max-width: 500px; margin: 30px auto; padding: 30px; border: 1px solid #1e293b; background-color: #0b0f19; border-radius: 16px; color: #f8fafc; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 12px; color: white; font-weight: bold; font-size: 24px;">🎯</div>
            <h2 style="color: #ffffff; margin-top: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-size: 20px;">Sniper Trader</h2>
            <p style="color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; margin-top: 2px;">Multi Asset Scanner & Automator</p>
          </div>
          
          <hr style="border: 0; border-top: 1px solid #1e293b; margin: 20px 0;">
          
          <p style="font-size: 13px; color: #94a3b8; line-height: 1.6;">Hello,</p>
          <p style="font-size: 13px; color: #94a3b8; line-height: 1.6;">We received a request to log in or register a new identity on the Sniper Trader platform. Use the secure authorization code below to confirm access:</p>
          
          <div style="font-size: 32px; font-weight: 900; letter-spacing: 6px; text-align: center; margin: 30px 0; color: #6366f1; background-color: #020617; padding: 20px; border: 1px solid #1e293b; border-radius: 12px;">
            ${otp}
          </div>
          
          <p style="font-size: 11px; color: #475569; text-align: center; line-height: 1.5;">This verification code is strictly valid for the next 10 minutes.<br>If you did not request this access key, you can safely ignore this email.</p>
        </div>
      `,
    });
    
    console.log(`[Email Service] ✅ Verification email sent successfully to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[Email Service] ❌ Failed to send verification email to ${email}:`, err.message);
    return false;
  }
}
