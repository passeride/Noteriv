import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { Section } from "@/components/LegalShell";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use · Điều khoản sử dụng — Noteriv" };

const who = OPERATOR_NAME || "[họ tên chủ dự án]";
const mail = CONTACT_EMAIL || "[email liên hệ]";

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Use / Điều khoản sử dụng">
      <Section id="en" lang="en" title="English">
        <h3>1. The service</h3>
        <p>
          Noteriv is a web-based Markdown note-taking app run by {who}, an individual based in Vietnam. Signing up may require an invite code.
          By creating an account you agree to these terms and to the <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h3>2. Who can use it</h3>
        <p>
          You must be at least 16, or have a parent or guardian (or the school or organisation that sets up your account) create the account and
          agree on your behalf.
        </p>

        <h3>3. Accounts</h3>
        <ul>
          <li>Provide accurate information, keep your password secret, and you are responsible for activity under your account.</li>
          <li>An invite code is for the person invited; do not sell or post it publicly.</li>
        </ul>

        <h3>4. Your content</h3>
        <ul>
          <li>You keep all rights to what you create. You grant us only the permission to store, back up and display it to you (and people you share with) in order to run the service.</li>
          <li>You warrant you have the right to upload your content and that it does not break the law or others’ rights.</li>
        </ul>

        <h3>5. Acceptable use</h3>
        <p>Do not use Noteriv to: distribute unlawful content or infringe others’ rights; attack, probe or overload the system; access other people’s data; run malicious plugins or try to escape the plugin sandbox.</p>

        <h3>6. Plugins</h3>
        <p>Third-party plugins run in a browser sandbox but may still display or process content you allow them to. Use your judgement before installing one.</p>

        <h3>7. Plans and payment</h3>
        <ul>
          <li>Each account is on a plan with limits (for example the number of vaults or the storage for attachments), shown in Settings → Plan and usage. Reaching a limit stops new additions; it never deletes what you have.</li>
          <li>All plans are currently free. If we introduce paid plans, their price, billing and refund terms will be shown to you before you buy, and nothing is charged without your order.</li>
        </ul>

        <h3>8. Backups and liability</h3>
        <ul>
          <li>We back up nightly but <strong>cannot guarantee</strong> that data will never be lost. Keep your own copy of anything important (export is built in).</li>
          <li>The service is provided “as is” and may be interrupted or changed. To the extent permitted by law we are not liable for indirect damages or data loss beyond our reasonable control.</li>
          <li>Nothing in these terms limits rights you have as a consumer that the law of your country does not allow to be limited.</li>
        </ul>

        <h3>9. Suspension and termination</h3>
        <p>
          We may lock or delete accounts that break these terms (with notice where practical). You can delete your account at any time in the app,
          after downloading your data if you wish.
        </p>

        <h3>10. Changes</h3>
        <p>
          We may update these terms. When a change matters, we tell you in the app and ask you to accept the new version before you go on using
          the service. If you do not accept, you can still download your data and delete your account.
        </p>

        <h3>11. Governing law and contact</h3>
        <p>
          These terms are governed by the laws of Vietnam. If you are a consumer, you also keep the protection of the mandatory rules of the
          country where you live, and may bring a claim there. Contact: {who} — <a href={`mailto:${mail}`}>{mail}</a>.
        </p>
      </Section>

      <Section id="vi" lang="vi" title="Tiếng Việt">
        <h3>1. Dịch vụ</h3>
        <p>
          Noteriv là ứng dụng ghi chú Markdown trên web do {who}, một cá nhân ở Việt Nam, vận hành. Việc đăng ký có thể cần mã mời. Khi tạo tài
          khoản, bạn đồng ý với các điều khoản này và <Link href="/privacy">Chính sách quyền riêng tư</Link>.
        </p>

        <h3>2. Ai được dùng</h3>
        <p>
          Bạn phải từ 16 tuổi trở lên, hoặc có phụ huynh hay người giám hộ (hoặc trường học, tổ chức tạo tài khoản cho bạn) tạo tài khoản và đồng
          ý thay bạn.
        </p>

        <h3>3. Tài khoản</h3>
        <ul>
          <li>Bạn cung cấp thông tin đúng, giữ bí mật mật khẩu và chịu trách nhiệm về hoạt động trong tài khoản của mình.</li>
          <li>Mã mời dùng cho người được mời; không bán hoặc phát tán công khai.</li>
        </ul>

        <h3>4. Nội dung của bạn</h3>
        <ul>
          <li>Bạn giữ toàn quyền với nội dung bạn tạo. Bạn chỉ cấp cho chúng tôi quyền lưu, sao lưu và hiển thị nội dung đó cho bạn (và người bạn chia sẻ) để vận hành dịch vụ.</li>
          <li>Bạn bảo đảm có quyền đối với nội dung tải lên và không vi phạm pháp luật hay quyền của người khác.</li>
        </ul>

        <h3>5. Sử dụng chấp nhận được</h3>
        <p>Không dùng Noteriv để: phát tán nội dung trái pháp luật hoặc xâm phạm quyền người khác; tấn công, dò quét hay làm quá tải hệ thống; truy cập dữ liệu của người khác; chạy plugin độc hại hoặc cố thoát khỏi hộp cát của plugin.</p>

        <h3>6. Plugin</h3>
        <p>Plugin do bên thứ ba viết chạy trong hộp cát của trình duyệt nhưng vẫn có thể hiển thị hoặc xử lý nội dung bạn cho phép. Bạn tự cân nhắc trước khi cài.</p>

        <h3>7. Gói và thanh toán</h3>
        <ul>
          <li>Mỗi tài khoản thuộc một gói có hạn mức (ví dụ số vault hay dung lượng tệp đính kèm), xem ở Cài đặt → Gói và mức dùng. Chạm hạn mức thì không thêm được nữa; dữ liệu đang có không bao giờ bị xoá vì lý do đó.</li>
          <li>Hiện mọi gói đều miễn phí. Nếu có gói trả phí, giá, cách thanh toán và điều kiện hoàn tiền sẽ được hiện cho bạn trước khi mua, và không có khoản thu nào nếu bạn không đặt mua.</li>
        </ul>

        <h3>8. Sao lưu và giới hạn trách nhiệm</h3>
        <ul>
          <li>Chúng tôi sao lưu hằng đêm nhưng <strong>không bảo đảm tuyệt đối</strong> không mất dữ liệu. Hãy giữ bản sao quan trọng (tính năng xuất dữ liệu có sẵn).</li>
          <li>Dịch vụ được cung cấp “nguyên trạng”, có thể gián đoạn hoặc thay đổi. Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm cho thiệt hại gián tiếp hoặc mất dữ liệu ngoài khả năng kiểm soát hợp lý.</li>
          <li>Không điều nào ở đây hạn chế các quyền người tiêu dùng mà pháp luật nước bạn không cho phép hạn chế.</li>
        </ul>

        <h3>9. Tạm ngừng và chấm dứt</h3>
        <p>
          Chúng tôi có thể khoá hoặc xoá tài khoản vi phạm điều khoản (nếu có thể, sẽ báo trước). Bạn có thể xoá tài khoản bất cứ lúc nào trong
          ứng dụng, sau khi tải dữ liệu về nếu muốn.
        </p>

        <h3>10. Thay đổi</h3>
        <p>
          Chúng tôi có thể cập nhật điều khoản. Khi thay đổi đáng kể, chúng tôi thông báo trong ứng dụng và hỏi bạn đồng ý bản mới trước khi tiếp
          tục dùng. Nếu không đồng ý, bạn vẫn tải được dữ liệu về và xoá được tài khoản.
        </p>

        <h3>11. Luật áp dụng và liên hệ</h3>
        <p>
          Điều khoản này chịu sự điều chỉnh của pháp luật Việt Nam. Nếu bạn là người tiêu dùng, bạn vẫn được bảo vệ theo các quy định bắt buộc của
          nước nơi bạn sống và có thể khởi kiện tại đó. Liên hệ: {who} — <a href={`mailto:${mail}`}>{mail}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
