// Account emails, in the two interface languages. They live here, not in packages/ui's catalog, because web/server is
// built on its own (no workspace packages). Keep the wording in step with the web pages the links open.

export type EmailLocale = "en" | "vi";

export function toEmailLocale(value: unknown): EmailLocale | null {
  return value === "en" || value === "vi" ? value : null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface Parts {
  subject: string;
  greeting: string;
  lines: string[];
  button?: { label: string; url: string };
  footer: string;
}

function render(p: Parts): RenderedEmail {
  const text = [p.greeting, "", ...p.lines, ...(p.button ? ["", `${p.button.label}: ${p.button.url}`] : []), "", p.footer].join("\n");
  const button = p.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(p.button.url)}" style="background:#7c3aed;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(p.button.label)}</a></p>
<p style="color:#666;font-size:13px;word-break:break-all">${escapeHtml(p.button.url)}</p>`
    : "";
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#222;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(p.greeting)}</p>
${p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
${button}
<p style="color:#666;font-size:13px;margin-top:32px">${escapeHtml(p.footer)}</p>
</body></html>`;
  return { subject: p.subject, html, text };
}

const FOOTER: Record<EmailLocale, string> = {
  en: "Noteriv · This is an automatic message; replies are not read.",
  vi: "Noteriv · Đây là thư tự động, thư trả lời sẽ không được đọc.",
};

export function verifyEmailMessage(locale: EmailLocale, name: string, url: string): RenderedEmail {
  return render(
    locale === "vi"
      ? {
          subject: "Xác minh email cho tài khoản Noteriv",
          greeting: `Chào ${name},`,
          lines: ["Bấm nút dưới đây để xác nhận đây là email của bạn. Liên kết hết hạn sau 24 giờ.", "Nếu bạn không tạo tài khoản Noteriv, hãy bỏ qua thư này."],
          button: { label: "Xác minh email", url },
          footer: FOOTER.vi,
        }
      : {
          subject: "Verify the email for your Noteriv account",
          greeting: `Hi ${name},`,
          lines: ["Confirm that this is your email address with the button below. The link expires in 24 hours.", "If you did not create a Noteriv account, you can ignore this email."],
          button: { label: "Verify email", url },
          footer: FOOTER.en,
        }
  );
}

export function resetPasswordMessage(locale: EmailLocale, name: string, url: string): RenderedEmail {
  return render(
    locale === "vi"
      ? {
          subject: "Đặt lại mật khẩu Noteriv",
          greeting: `Chào ${name},`,
          lines: [
            "Có người (có thể là bạn) vừa yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút dưới đây để chọn mật khẩu mới. Liên kết hết hạn sau 1 giờ và chỉ dùng được một lần.",
            "Sau khi đổi, mọi thiết bị đang đăng nhập sẽ phải đăng nhập lại.",
            "Nếu bạn không yêu cầu, hãy bỏ qua thư này: mật khẩu vẫn giữ nguyên.",
          ],
          button: { label: "Đặt lại mật khẩu", url },
          footer: FOOTER.vi,
        }
      : {
          subject: "Reset your Noteriv password",
          greeting: `Hi ${name},`,
          lines: [
            "Someone (hopefully you) asked to reset the password for this account. Choose a new password with the button below. The link expires in 1 hour and works once.",
            "After the change, every device that is signed in has to sign in again.",
            "If you did not ask for this, ignore this email: your password stays the same.",
          ],
          button: { label: "Reset password", url },
          footer: FOOTER.en,
        }
  );
}

export function confirmNewEmailMessage(locale: EmailLocale, name: string, url: string): RenderedEmail {
  return render(
    locale === "vi"
      ? {
          subject: "Xác nhận email mới cho tài khoản Noteriv",
          greeting: `Chào ${name},`,
          lines: [
            "Bạn đã yêu cầu dùng địa chỉ này cho tài khoản Noteriv. Bấm nút dưới đây để xác nhận. Liên kết hết hạn sau 24 giờ.",
            "Sau khi đổi, bạn đăng nhập bằng địa chỉ này; mọi thiết bị sẽ phải đăng nhập lại.",
            "Nếu không phải bạn yêu cầu, hãy bỏ qua thư này.",
          ],
          button: { label: "Xác nhận email mới", url },
          footer: FOOTER.vi,
        }
      : {
          subject: "Confirm the new email for your Noteriv account",
          greeting: `Hi ${name},`,
          lines: [
            "You asked to use this address for your Noteriv account. Confirm it with the button below. The link expires in 24 hours.",
            "After the change you sign in with this address, and every device has to sign in again.",
            "If you did not ask for this, ignore this email.",
          ],
          button: { label: "Confirm new email", url },
          footer: FOOTER.en,
        }
  );
}

export function emailChangedNotice(locale: EmailLocale, name: string, newEmail: string): RenderedEmail {
  return render(
    locale === "vi"
      ? {
          subject: "Email tài khoản Noteriv đã được đổi",
          greeting: `Chào ${name},`,
          lines: [
            `Email đăng nhập của tài khoản Noteriv vừa được đổi thành ${newEmail}. Từ nay thư của tài khoản sẽ gửi tới địa chỉ đó.`,
            "Nếu không phải bạn đổi, hãy liên hệ ngay qua địa chỉ ghi trong trang Chính sách quyền riêng tư của Noteriv.",
          ],
          footer: FOOTER.vi,
        }
      : {
          subject: "Your Noteriv account email was changed",
          greeting: `Hi ${name},`,
          lines: [
            `The sign-in email of your Noteriv account was just changed to ${newEmail}. Account emails now go to that address.`,
            "If you did not make this change, contact us right away at the address in Noteriv's Privacy Policy.",
          ],
          footer: FOOTER.en,
        }
  );
}
