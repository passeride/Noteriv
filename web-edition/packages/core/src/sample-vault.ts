// The "Getting started" vault a new user starts with: a few short notes that show links, backlinks, tags, plugins and
// sync by using them. Web creates it at sign-up, desktop when the setup wizard makes a new vault. The text is written
// by hand per language (not catalog keys) because it is note content the user owns and edits afterwards.

export type SampleVaultLocale = "en" | "vi";

export interface SampleVaultFile {
  /** Vault-relative path with forward slashes, e.g. "Templates/Daily note.md". */
  path: string;
  content: string;
}

export interface SampleVault {
  name: string;
  files: SampleVaultFile[];
}

const EN: SampleVault = {
  name: "Getting started",
  files: [
    {
      path: "Welcome.md",
      content: `# Welcome to Noteriv

Noteriv keeps your notes as plain Markdown files. This vault is yours to read, edit and delete — nothing in it is special.

## Start here

- [[Links and backlinks]] — connect notes with \`[[double brackets]]\`.
- [[Tags]] — group notes with \`#tags\`.
- [[Plugins]] — turn extra features on and off.
- [[Sync and devices]] — keep your notes on more than one device.

## A few things to try

1. Create a note: the **New note** button at the top of the file list.
2. Run any command, and see its keyboard shortcut: the command palette, \`Ctrl/Cmd + Shift + P\`.
3. Search every note: the search icon in the left ribbon.
4. Change the language, theme and editor: **Settings** (\`Ctrl/Cmd + ,\`).

When you are ready, create your own vault and delete this one.

#getting-started
`,
    },
    {
      path: "Links and backlinks.md",
      content: `# Links and backlinks

Type \`[[\` and pick a note to link to it, like this link back to [[Welcome]]. If the note does not exist yet, clicking the link creates it.

- **Backlinks**: the Backlinks panel shows every note that links to the note you are reading. Open [[Welcome]] and you will see this note there.
- **Aliases**: \`[[Welcome|the start page]]\` shows different text for the same link.
- **Headings**: \`[[Tags#Finding tagged notes]]\` links straight to a heading.
- **Graph**: the graph view draws your notes and the links between them.

#getting-started
`,
    },
    {
      path: "Tags.md",
      content: `# Tags

Write \`#\` followed by a word anywhere in a note: #ideas, #reading, #project/website. A slash makes nested tags.

## Finding tagged notes

- The **Tags** panel lists every tag in the vault with a count; click one to see its notes.
- Search for \`#ideas\` to find the notes that use it.

Tags and links work well together: link notes that belong to one topic, tag notes that share a status or type. Back to [[Welcome]].

#getting-started
`,
    },
    {
      path: "Plugins.md",
      content: `# Plugins

Noteriv comes with core plugins you can switch on and off in **Settings → Core plugins**. Some of them:

- **Templates** — insert a note from the \`Templates\` folder. Try it with [[Daily note]].
- **Calendar** — daily notes by date.
- **Graph** — the map of your notes.
- **Note history** — earlier versions of a note.
- **Word count**, **Canvas**, **Board**, **Slides** and more are off until you turn them on.

Community plugins add even more; browse them in the **Plugins** window. A plugin only gets the permissions you approve. Back to [[Welcome]].

#getting-started
`,
    },
    {
      path: "Sync and devices.md",
      content: `# Sync and devices

Your notes are Markdown files, so they are never locked in.

- **Web**: notes are stored in your account and open from any browser. To also keep them in a Git repository or on a WebDAV server, use **Settings → Sync**.
- **Desktop**: a vault is a folder on your computer. Turn on Git when you create the vault, or later in Settings, to sync it with a repository.
- **Import and export**: bring in an existing folder or zip of Markdown files, or download a vault as a zip at any time.

If the same note changes in two places, Noteriv keeps both versions and shows you the difference. Back to [[Welcome]].

#getting-started
`,
    },
    {
      path: "Templates/Daily note.md",
      content: `# {{title}}

Date: {{date}}

## Plan

-

## Notes

`,
    },
  ],
};

const VI: SampleVault = {
  name: "Bắt đầu",
  files: [
    {
      path: "Chào mừng.md",
      content: `# Chào mừng đến với Noteriv

Noteriv lưu note dưới dạng file Markdown thuần. Vault này là của bạn: đọc, sửa, xoá tuỳ ý — không có gì đặc biệt trong đó.

## Bắt đầu từ đây

- [[Liên kết và backlink]] — nối các note bằng \`[[ngoặc vuông kép]]\`.
- [[Thẻ]] — gom note bằng \`#thẻ\`.
- [[Plugin]] — bật tắt các tính năng thêm.
- [[Đồng bộ và thiết bị]] — dùng note trên nhiều thiết bị.

## Vài điều nên thử

1. Tạo note: nút **Note mới** ở đầu danh sách file.
2. Chạy lệnh bất kỳ và xem phím tắt của nó: bảng lệnh, \`Ctrl/Cmd + Shift + P\`.
3. Tìm trong mọi note: biểu tượng tìm kiếm ở ribbon bên trái.
4. Đổi ngôn ngữ, giao diện, trình soạn thảo: **Cài đặt** (\`Ctrl/Cmd + ,\`).

Khi đã quen, hãy tạo vault của riêng bạn và xoá vault này.

#bat-dau
`,
    },
    {
      path: "Liên kết và backlink.md",
      content: `# Liên kết và backlink

Gõ \`[[\` rồi chọn một note để liên kết tới nó, như liên kết quay về [[Chào mừng]] này. Nếu note chưa có, bấm vào liên kết sẽ tạo note đó.

- **Backlink**: panel Backlinks liệt kê mọi note liên kết tới note bạn đang đọc. Mở [[Chào mừng]] sẽ thấy note này ở đó.
- **Tên hiển thị**: \`[[Chào mừng|trang đầu]]\` hiện chữ khác cho cùng một liên kết.
- **Tiêu đề**: \`[[Thẻ#Tìm note theo thẻ]]\` dẫn thẳng tới một tiêu đề.
- **Graph**: màn hình graph vẽ các note và liên kết giữa chúng.

#bat-dau
`,
    },
    {
      path: "Thẻ.md",
      content: `# Thẻ

Viết \`#\` rồi một từ ở bất kỳ đâu trong note: #y-tuong, #doc-sach, #du-an/website. Dấu gạch chéo tạo thẻ lồng nhau.

## Tìm note theo thẻ

- Panel **Tags** liệt kê mọi thẻ trong vault kèm số note; bấm một thẻ để xem các note của nó.
- Tìm \`#y-tuong\` để thấy các note dùng thẻ đó.

Thẻ và liên kết bổ sung cho nhau: liên kết các note cùng chủ đề, gắn thẻ các note cùng trạng thái hay cùng loại. Quay về [[Chào mừng]].

#bat-dau
`,
    },
    {
      path: "Plugin.md",
      content: `# Plugin

Noteriv có sẵn các core plugin, bật tắt trong **Cài đặt → Core plugins**. Một vài plugin:

- **Templates** — chèn một note từ thư mục \`Templates\`. Thử với [[Nhật ký ngày]].
- **Calendar** — note hằng ngày theo ngày.
- **Graph** — bản đồ các note.
- **Note history** — các phiên bản trước của một note.
- **Word count**, **Canvas**, **Board**, **Slides** và nhiều plugin khác tắt cho tới khi bạn bật.

Plugin cộng đồng còn thêm nhiều nữa; xem trong cửa sổ **Plugin**. Plugin chỉ có những quyền bạn đồng ý. Quay về [[Chào mừng]].

#bat-dau
`,
    },
    {
      path: "Đồng bộ và thiết bị.md",
      content: `# Đồng bộ và thiết bị

Note của bạn là file Markdown, nên không bao giờ bị khoá trong một ứng dụng.

- **Web**: note lưu trong tài khoản, mở được từ mọi trình duyệt. Muốn lưu thêm vào kho Git hay máy chủ WebDAV, vào **Cài đặt → Đồng bộ**.
- **Desktop**: vault là một thư mục trên máy. Bật Git khi tạo vault, hoặc sau đó trong Cài đặt, để đồng bộ với một kho.
- **Nhập và xuất**: đưa vào một thư mục hay file zip Markdown có sẵn, hoặc tải vault về dạng zip bất cứ lúc nào.

Nếu cùng một note bị sửa ở hai nơi, Noteriv giữ cả hai bản và cho bạn xem chỗ khác nhau. Quay về [[Chào mừng]].

#bat-dau
`,
    },
    {
      path: "Templates/Nhật ký ngày.md",
      content: `# {{title}}

Ngày: {{date}}

## Kế hoạch

-

## Ghi chú

`,
    },
  ],
};

/** The sample vault in the given interface language. Returns fresh objects, so callers may change them. */
export function sampleVault(locale: SampleVaultLocale): SampleVault {
  const source = locale === "vi" ? VI : EN;
  return { name: source.name, files: source.files.map((f) => ({ ...f })) };
}

/** The language to build the sample vault in for an interface locale ("vi-VN" → "vi", anything unknown → "en"). */
export function sampleVaultLocale(locale: string): SampleVaultLocale {
  return locale.toLowerCase().startsWith("vi") ? "vi" : "en";
}
