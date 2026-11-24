import Link from "next/link";
import type { ReactNode } from "react";
import { CONTACT_EMAIL, LAST_UPDATED, OPERATOR_NAME, isDraft } from "@/lib/legal";
import StatusLink from "@/components/StatusLink";

/**
 * Common frame for the legal pages: draft banner, English / Vietnamese jump links, cross links. The texts are written
 * by hand in both languages (English first) rather than kept in the i18n catalogs: a legal text is reviewed as a whole.
 */
export default function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex justify-center px-4 py-12">
      <main className="w-full max-w-3xl flex flex-col gap-6 text-[var(--text-primary)]">
        <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
          <Link href="/" className="hover:text-[var(--text-primary)]">
            ← Noteriv
          </Link>
          <nav className="flex gap-4">
            <a href="#en" className="hover:text-[var(--text-primary)]">
              English
            </a>
            <a href="#vi" className="hover:text-[var(--text-primary)]">
              Tiếng Việt
            </a>
            <Link href="/terms" className="hover:text-[var(--text-primary)]">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--text-primary)]">
              Privacy
            </Link>
            <StatusLink label="Status" separator={false} />
          </nav>
        </div>

        {isDraft && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm">
            <strong>Draft / Bản nháp.</strong> Not yet reviewed or completed by the operator. This is not legal advice. / Nội dung
            chưa được chủ dự án duyệt và chưa điền thông tin chủ thể vận hành. Đây không phải tư vấn pháp lý.
          </div>
        )}

        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Last updated / Cập nhật: {LAST_UPDATED}. Operator / Chủ thể vận hành: {OPERATOR_NAME || "[operator name]"}
          {" · "}
          {CONTACT_EMAIL || "[contact email]"}
        </p>

        {children}
      </main>
    </div>
  );
}

export function Section({ id, lang, title, children }: { id: string; lang: "vi" | "en"; title: string; children: ReactNode }) {
  return (
    <section id={id} lang={lang} className="flex flex-col gap-3 border-t border-[var(--border)] pt-6 scroll-mt-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-2 [&_a]:text-[var(--accent)]">
        {children}
      </div>
    </section>
  );
}
