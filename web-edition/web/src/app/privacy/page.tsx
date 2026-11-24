import type { Metadata } from "next";
import LegalShell, { Section } from "@/components/LegalShell";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · Chính sách quyền riêng tư — Noteriv" };

const who = OPERATOR_NAME || "[họ tên chủ dự án]";
const mail = CONTACT_EMAIL || "[email liên hệ]";

// The retention periods below are enforced in code: web/server/src/lib/retention.ts (security log, expired tokens),
// lib/activity.ts (usage days), lib/trash.ts (trash), lib/plans.ts (note history). The service providers are the ones
// the code calls: lib/email (Resend), lib/sentry.ts + web/src/lib/error-reporting.ts (Sentry), lib/turnstile.ts
// (Cloudflare), web/infra/backup (GitHub). Change this page and TERMS_VERSION together with them.

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy / Chính sách quyền riêng tư">
      <Section id="en" lang="en" title="English">
        <p>
          Noteriv is a browser-based Markdown note-taking app. This page explains what we store about you, why, where, for how long, who
          helps us handle it, and what control you have.
        </p>

        <h3>1. Who is responsible</h3>
        <p>
          Noteriv is run by {who}, an individual based in Vietnam, who decides how your data is used (the “controller” under the EU General Data
          Protection Regulation, GDPR). Contact: <a href={`mailto:${mail}`}>{mail}</a>.
        </p>

        <h3>2. Data we store</h3>
        <ul>
          <li>Account: email, display name, a one-way hash of your password (never the password itself), the invite code you used, when and which version of the terms you accepted, and whether you have verified your email.</li>
          <li>Content you create: notes, folders, attachments, earlier versions of notes, settings, plugins you install.</li>
          <li>Sync credentials (GitHub, WebDAV) if you set them up: encrypted on the server.</li>
          <li>Security log: events such as sign-up, sign-in, failed sign-in, vault creation/deletion and administrator actions, with IP address, to detect abuse.</li>
          <li>
            Usage records: the days on which you signed in or used the app, so we can count active users and how many come back. They are
            counted on our own server; we use no third-party analytics.
          </li>
          <li>Error reports when something breaks (section 5).</li>
          <li>An httpOnly sign-in cookie needed to keep your session. We use no advertising or tracking cookies.</li>
        </ul>

        <h3>3. Why we use it (legal basis)</h3>
        <ul>
          <li>
            <strong>To provide the service you signed up for</strong> (performance of a contract, GDPR Art. 6(1)(b)): your account, your content and
            its earlier versions, sync you set up, and the emails about your account (verifying your address, resetting your password, confirming
            a new address).
          </li>
          <li>
            <strong>Our legitimate interests</strong> (GDPR Art. 6(1)(f)) in keeping the service secure and working: the security log, the check
            that tells people from bots, error reports, and usage counts. We keep these to the minimum listed here. You can object to them by
            writing to us (section 8).
          </li>
          <li>If we start charging for plans, we will keep billing records because tax law requires it (legal obligation, GDPR Art. 6(1)(c)).</li>
        </ul>
        <p>We do not sell data, share it for advertising, or make decisions about you by automated means.</p>

        <h3>4. How long we keep it</h3>
        <ul>
          <li>Account and content: until you delete them or delete your account.</li>
          <li>Deleted notes and folders stay in the vault’s trash for 30 days, then go. Earlier versions of a note: a fixed number per note (50 on the free plan), oldest first.</li>
          <li>Usage records: about 13 months.</li>
          <li>Security log: 12 months.</li>
          <li>Sign-in sessions end after 30 days at most; links in account emails work for 1 to 24 hours. Expired ones are deleted a month later.</li>
          <li>Error reports: 30 days at Sentry.</li>
          <li>Backups: up to about 12 months (section 9).</li>
        </ul>

        <h3>5. Who handles data for us</h3>
        <p>These providers process data on our behalf, only for the purpose given:</p>
        <ul>
          <li>
            <strong>Server hosting</strong>: a virtual private server (VPS) we rent from a hosting company, in a data centre in{" "}
            <strong>Singapore</strong>. The app, the database and attachment files are stored there.
          </li>
          <li>
            <strong>Resend</strong> (United States), email delivery: sends account emails. It receives your email address and the message, never
            your notes.
          </li>
          <li>
            <strong>Sentry</strong> (Functional Software, Inc.; data stored in the European Union, Germany), error tracking. When the app or the
            server hits an unexpected error it receives a technical report: the error and where in the code it happened, browser and operating
            system, the page address without its parameters, and your account’s internal id. Email addresses and tokens are removed from it, and it
            never contains your notes or your IP address.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> (Cloudflare, Inc., United States), a check that tells people from bots on the sign-up and
            forgot-password forms. Cloudflare receives your IP address and technical signals from your browser for that check; it does not set
            advertising cookies.
          </li>
          <li>
            <strong>GitHub</strong> (GitHub, Inc., United States), backup storage: nightly backups are <strong>encrypted</strong> before they are
            pushed to a private repository of ours. The decryption key is not on the server, so GitHub cannot read them.
          </li>
          <li>
            Monitoring (UptimeRobot, healthchecks.io) only receives “alive/failed” signals and the site’s public address, never personal data.
          </li>
        </ul>
        <p>
          If you connect a vault to GitHub or a WebDAV server, your vault data is sent to the service <strong>you</strong> choose, under your own
          agreement with it.
        </p>

        <h3>6. Transfers outside your country</h3>
        <p>
          Our server is in Singapore and some providers above are in the United States, so your data leaves the European Economic Area and the
          United Kingdom. Where the destination has no adequacy decision, we rely on the safeguards the provider offers, such as the European
          Commission’s Standard Contractual Clauses or the EU–US Data Privacy Framework. You can ask us for details.
        </p>

        <h3>7. How we protect it</h3>
        <p>
          Connections use HTTPS; passwords are stored only as one-way hashes; sync credentials are encrypted; backups are encrypted with a key kept
          off the server; only the operator can reach the server and the database.
        </p>

        <h3>8. Your rights</h3>
        <ul>
          <li>Access and portability: “Your vaults” page → “Download all my data (JSON)”; each vault can also be exported as .zip.</li>
          <li>
            Deletion: deleting a vault or “Delete account” immediately removes notes, folders, settings and <strong>attachment files</strong> from the live system.
          </li>
          <li>Correction: change your email in the app (“Change email” on the “Your vaults” page); for anything else, write to us.</li>
          <li>Restriction and objection: write to us if you want us to stop or limit a use of your data, including those based on our legitimate interests.</li>
          <li>You can also complain to the data protection authority where you live or work.</li>
        </ul>
        <p>We answer requests within one month, and aim for 14 days.</p>

        <h3>9. Backup limits you should know about</h3>
        <p>
          Encrypted backups are not edited for each small change. Database backups are kept on a rotation (roughly 7 daily, 4 weekly, 12 monthly),
          so after you delete your account its data disappears from them as they are overwritten (up to about 12 months). <strong>Attachment
          files</strong> are backed up append-only, so a deleted file may remain in the encrypted backup repository until we clean that repository.
          If you want it gone for good, write to us; we will remove it manually and confirm.
        </p>

        <h3>10. Children</h3>
        <p>If a user is under 16, a parent or guardian, or the school or organisation that set up the account, is responsible for creating it and consenting on their behalf.</p>

        <h3>11. Organisations</h3>
        <p>
          If your organisation uses Noteriv for personal data it is responsible for and needs a data processing agreement (DPA), write to us and we
          will provide one.
        </p>

        <h3>12. Contact</h3>
        <p>
          {who} — <a href={`mailto:${mail}`}>{mail}</a>.
        </p>

        <h3>13. Changes</h3>
        <p>
          If this policy changes materially we update the date at the top, tell you in the app, and ask you to accept the new version before you go
          on using it.
        </p>
      </Section>

      <Section id="vi" lang="vi" title="Tiếng Việt">
        <p>
          Noteriv là ứng dụng ghi chú Markdown chạy trên trình duyệt. Trang này nói rõ chúng tôi lưu gì về bạn, vì sao, lưu ở đâu, trong bao lâu,
          ai giúp chúng tôi xử lý, và bạn kiểm soát dữ liệu đó thế nào.
        </p>

        <h3>1. Ai chịu trách nhiệm</h3>
        <p>
          Noteriv do {who}, một cá nhân ở Việt Nam, vận hành và quyết định cách dữ liệu của bạn được dùng (“bên kiểm soát dữ liệu” theo Quy định
          chung về bảo vệ dữ liệu của EU, GDPR). Liên hệ: <a href={`mailto:${mail}`}>{mail}</a>.
        </p>

        <h3>2. Dữ liệu chúng tôi lưu</h3>
        <ul>
          <li>Tài khoản: email, tên hiển thị, mật khẩu ở dạng băm một chiều (không lưu mật khẩu gốc), mã mời bạn đã dùng, thời điểm và phiên bản điều khoản bạn đã đồng ý, và email đã được xác minh hay chưa.</li>
          <li>Nội dung bạn tạo: ghi chú, thư mục, tệp đính kèm, các bản cũ của ghi chú, cài đặt, plugin bạn cài.</li>
          <li>Thông tin kết nối đồng bộ (GitHub, WebDAV) nếu bạn tự cấu hình: được mã hoá trên máy chủ.</li>
          <li>Nhật ký bảo mật: các sự kiện như đăng ký, đăng nhập, đăng nhập sai, tạo/xoá vault và thao tác của quản trị viên, kèm địa chỉ IP, để phát hiện lạm dụng.</li>
          <li>
            Dữ liệu sử dụng: những ngày bạn đăng nhập hoặc dùng ứng dụng, để đếm số người dùng đang hoạt động và số người quay lại. Việc đếm làm
            trên máy chủ của chúng tôi; chúng tôi không dùng công cụ phân tích của bên thứ ba.
          </li>
          <li>Báo cáo lỗi khi có sự cố (mục 5).</li>
          <li>Cookie đăng nhập (httpOnly) cần thiết để giữ phiên. Chúng tôi không dùng cookie quảng cáo hay theo dõi.</li>
        </ul>

        <h3>3. Vì sao chúng tôi dùng dữ liệu (cơ sở pháp lý)</h3>
        <ul>
          <li>
            <strong>Để cung cấp dịch vụ bạn đã đăng ký</strong> (thực hiện hợp đồng, Điều 6(1)(b) GDPR): tài khoản, nội dung và các bản cũ của nó,
            đồng bộ do bạn cấu hình, và thư về tài khoản (xác minh địa chỉ, đặt lại mật khẩu, xác nhận địa chỉ mới).
          </li>
          <li>
            <strong>Lợi ích chính đáng của chúng tôi</strong> (Điều 6(1)(f) GDPR) trong việc giữ dịch vụ an toàn và chạy ổn: nhật ký bảo mật, bước
            kiểm tra người hay bot, báo cáo lỗi và số liệu sử dụng. Chúng tôi chỉ giữ ở mức tối thiểu nêu tại đây. Bạn có thể phản đối việc này
            bằng cách viết cho chúng tôi (mục 8).
          </li>
          <li>Nếu bắt đầu thu phí, chúng tôi sẽ giữ chứng từ thanh toán vì luật thuế yêu cầu (nghĩa vụ pháp lý, Điều 6(1)(c) GDPR).</li>
        </ul>
        <p>Chúng tôi không bán dữ liệu, không chia sẻ để quảng cáo, và không ra quyết định về bạn bằng phương tiện tự động.</p>

        <h3>4. Chúng tôi giữ dữ liệu bao lâu</h3>
        <ul>
          <li>Tài khoản và nội dung: cho tới khi bạn xoá chúng hoặc xoá tài khoản.</li>
          <li>Ghi chú và thư mục đã xoá nằm trong thùng rác của vault 30 ngày rồi bị xoá hẳn. Các bản cũ của ghi chú: giữ một số lượng cố định cho mỗi ghi chú (50 ở gói miễn phí), bỏ bản cũ nhất trước.</li>
          <li>Dữ liệu sử dụng: khoảng 13 tháng.</li>
          <li>Nhật ký bảo mật: 12 tháng.</li>
          <li>Phiên đăng nhập kết thúc sau tối đa 30 ngày; liên kết trong thư tài khoản dùng được từ 1 đến 24 giờ. Phiên và liên kết đã hết hạn bị xoá sau đó một tháng.</li>
          <li>Báo cáo lỗi: 30 ngày tại Sentry.</li>
          <li>Sao lưu: tối đa khoảng 12 tháng (mục 9).</li>
        </ul>

        <h3>5. Ai xử lý dữ liệu cho chúng tôi</h3>
        <p>Các nhà cung cấp sau xử lý dữ liệu thay mặt chúng tôi, chỉ cho đúng mục đích nêu ở đây:</p>
        <ul>
          <li>
            <strong>Máy chủ</strong>: một máy chủ ảo (VPS) chúng tôi thuê của một công ty lưu trữ, đặt tại trung tâm dữ liệu ở{" "}
            <strong>Singapore</strong>. Ứng dụng, cơ sở dữ liệu và tệp đính kèm được lưu ở đó.
          </li>
          <li>
            <strong>Resend</strong> (Hoa Kỳ), dịch vụ gửi email: gửi thư về tài khoản. Resend nhận địa chỉ email của bạn và nội dung thư, không
            bao giờ nhận ghi chú.
          </li>
          <li>
            <strong>Sentry</strong> (Functional Software, Inc.; dữ liệu lưu tại Liên minh châu Âu, Đức), dịch vụ theo dõi lỗi. Khi ứng dụng hoặc
            máy chủ gặp lỗi không lường trước, Sentry nhận một báo cáo kỹ thuật: lỗi và vị trí trong mã, trình duyệt và hệ điều hành, địa chỉ trang
            (không kèm tham số), và mã nội bộ của tài khoản. Địa chỉ email và token được xoá khỏi báo cáo; báo cáo không bao giờ chứa ghi chú hay
            địa chỉ IP của bạn.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> (Cloudflare, Inc., Hoa Kỳ), bước kiểm tra phân biệt người với bot ở form đăng ký và quên mật
            khẩu. Cloudflare nhận địa chỉ IP và các tín hiệu kỹ thuật của trình duyệt cho việc kiểm tra đó; không đặt cookie quảng cáo.
          </li>
          <li>
            <strong>GitHub</strong> (GitHub, Inc., Hoa Kỳ), nơi lưu sao lưu: sao lưu hằng đêm được <strong>mã hoá</strong> trước khi gửi tới một
            kho riêng tư của chúng tôi. Khoá giải mã không nằm trên máy chủ, nên GitHub không đọc được.
          </li>
          <li>Dịch vụ giám sát (UptimeRobot, healthchecks.io) chỉ nhận tín hiệu “còn sống/lỗi” và địa chỉ công khai của trang, không nhận dữ liệu cá nhân.</li>
        </ul>
        <p>
          Nếu bạn nối một vault với GitHub hoặc một máy chủ WebDAV, dữ liệu vault được gửi tới dịch vụ do <strong>bạn</strong> chọn, theo thoả
          thuận riêng giữa bạn và dịch vụ đó.
        </p>

        <h3>6. Chuyển dữ liệu ra nước ngoài</h3>
        <p>
          Máy chủ của chúng tôi ở Singapore và một số nhà cung cấp nêu trên ở Hoa Kỳ, nên dữ liệu của bạn được chuyển ra ngoài Khu vực kinh tế
          châu Âu và Vương quốc Anh. Với nơi nhận chưa được công nhận là bảo vệ dữ liệu tương đương, chúng tôi dựa vào các biện pháp bảo vệ mà
          nhà cung cấp đưa ra, như Điều khoản hợp đồng mẫu của Uỷ ban châu Âu hoặc Khung bảo mật dữ liệu EU–Hoa Kỳ. Bạn có thể hỏi chúng tôi
          để biết chi tiết.
        </p>

        <h3>7. Chúng tôi bảo vệ dữ liệu thế nào</h3>
        <p>
          Kết nối dùng HTTPS; mật khẩu chỉ lưu ở dạng băm một chiều; thông tin kết nối đồng bộ được mã hoá; sao lưu được mã hoá bằng khoá giữ
          ngoài máy chủ; chỉ người vận hành truy cập được máy chủ và cơ sở dữ liệu.
        </p>

        <h3>8. Quyền của bạn</h3>
        <ul>
          <li>Truy cập và mang dữ liệu đi: trang “Vault của bạn” → “Tải xuống toàn bộ dữ liệu (JSON)”; mỗi vault cũng xuất được thành .zip.</li>
          <li>
            Xoá: xoá một vault hoặc “Xoá tài khoản” sẽ xoá ngay ghi chú, thư mục, cài đặt và <strong>tệp đính kèm</strong> khỏi hệ thống đang chạy.
          </li>
          <li>Sửa: đổi email trong ứng dụng (“Đổi email” ở trang “Vault của bạn”); thông tin khác thì viết cho chúng tôi.</li>
          <li>Hạn chế và phản đối: viết cho chúng tôi nếu bạn muốn ngừng hoặc giới hạn một việc dùng dữ liệu của bạn, kể cả những việc dựa trên lợi ích chính đáng của chúng tôi.</li>
          <li>Bạn cũng có thể khiếu nại tới cơ quan bảo vệ dữ liệu nơi bạn sống hoặc làm việc.</li>
        </ul>
        <p>Chúng tôi trả lời yêu cầu trong vòng một tháng, và cố gắng trong 14 ngày.</p>

        <h3>9. Giới hạn cần biết về sao lưu</h3>
        <p>
          Bản sao lưu đã mã hoá không bị sửa theo từng thay đổi nhỏ. Sao lưu cơ sở dữ liệu được giữ luân phiên (khoảng 7 bản theo ngày, 4 theo
          tuần, 12 theo tháng), nên khi bạn xoá tài khoản, dữ liệu trong đó biến mất dần khi bị ghi đè (tối đa khoảng 12 tháng). Riêng{" "}
          <strong>tệp đính kèm</strong> được sao lưu theo kiểu chỉ-thêm, nên một tệp đã xoá có thể còn trong kho sao lưu mã hoá cho đến khi chúng
          tôi dọn kho đó. Nếu bạn muốn xoá hẳn, hãy viết cho chúng tôi; chúng tôi sẽ xoá thủ công và xác nhận lại.
        </p>

        <h3>10. Trẻ em</h3>
        <p>Nếu người dùng dưới 16 tuổi, phụ huynh hoặc người giám hộ, hoặc trường học hay tổ chức đã tạo tài khoản, chịu trách nhiệm tạo tài khoản và đồng ý thay.</p>

        <h3>11. Tổ chức</h3>
        <p>
          Nếu tổ chức của bạn dùng Noteriv cho dữ liệu cá nhân mà tổ chức chịu trách nhiệm và cần thoả thuận xử lý dữ liệu (DPA), hãy viết cho
          chúng tôi, chúng tôi sẽ cung cấp.
        </p>

        <h3>12. Liên hệ</h3>
        <p>
          {who} — <a href={`mailto:${mail}`}>{mail}</a>.
        </p>

        <h3>13. Thay đổi</h3>
        <p>
          Nếu chính sách thay đổi đáng kể, chúng tôi cập nhật ngày ở đầu trang, thông báo trong ứng dụng và hỏi bạn đồng ý bản mới trước khi
          tiếp tục dùng.
        </p>
      </Section>
    </LegalShell>
  );
}
