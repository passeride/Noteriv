;;; noteriv.el --- Work with Noteriv vaults from Emacs -*- lexical-binding: t; -*-

;; Version: 0.1.0
;; Package-Requires: ((emacs "27.1"))
;; Keywords: files, hypermedia
;; URL: https://github.com/passeride/Noteriv
;; SPDX-License-Identifier: MIT

;;; Commentary:

;; Browse, search, create and capture notes using the Noteriv CLI.
;; Notes open as ordinary file buffers. Enable 'noteriv-mode' for the
;; optional C-c n command prefix.

;;; Code:

(require 'cl-lib)
(require 'json)
(require 'subr-x)

(defgroup noteriv nil
  "Work with Noteriv vaults."
  :group 'applications)

(defcustom noteriv-executable "noteriv"
  "Noteriv desktop executable, either on PATH or given by its full path."
  :type 'string)

(defcustom noteriv-vault nil
  "Vault ID, name or directory.  Nil chooses one from the current context."
  :type '(choice (const :tag "Automatic" nil) string))

(defcustom noteriv-inbox nil
  "Vault-relative path of an existing note for `noteriv-capture'.
Nil prompts for the note on every capture."
  :type '(choice (const :tag "Ask for destination" nil) string))

(defun noteriv--program ()
  (or (executable-find (if (file-name-directory noteriv-executable)
                           (expand-file-name noteriv-executable)
                         noteriv-executable))
      (user-error "Cannot find Noteriv.  Set noteriv-executable to its full path")))

(defun noteriv--call (args &optional input)
  "Run Noteriv with ARGS, sending INPUT as UTF-8 when supplied."
  (let ((program (noteriv--program))
        (default-directory temporary-file-directory)
        (coding-system-for-read 'utf-8-unix)
        (coding-system-for-write 'utf-8-unix)
        stdin stderr)
    (unwind-protect
        (with-temp-buffer
          (setq stderr (make-temp-file "noteriv-stderr-"))
          (when input
            (setq stdin (make-temp-file "noteriv-stdin-"))
            (write-region input nil stdin nil 'silent))
          (let ((status (apply #'process-file program stdin (list t stderr) nil args)))
            (unless (eq status 0)
              (let ((reason (with-temp-buffer
                              (insert-file-contents stderr)
                              (string-remove-prefix "noteriv: " (string-trim (buffer-string))))))
                (user-error "Noteriv: %s"
                            (if (string-empty-p reason)
                                (format "command failed (%s)" status)
                              reason))))
            (buffer-string)))
      (when stdin (delete-file stdin))
      (when stderr (delete-file stderr)))))

(defun noteriv--json (args)
  (condition-case nil
      (json-parse-string (noteriv--call args) :object-type 'alist :array-type 'list
                         :null-object nil :false-object nil)
    (json-error (user-error "Noteriv returned invalid JSON for %s" (car args)))))

(defun noteriv--choose-vault (vaults)
  (unless vaults (user-error "Create or open a vault in Noteriv first"))
  (let ((choices (mapcar (lambda (vault)
                          (cons (format "%s — %s [%s]" (alist-get 'name vault)
                                        (alist-get 'path vault) (alist-get 'id vault))
                                vault))
                        vaults)))
    (cdr (assoc (completing-read "Noteriv vault: " choices nil t) choices))))

(defun noteriv--containing-vault (file vaults)
  (when (and file (not (file-remote-p file)))
    (cl-reduce (lambda (best vault)
                 (let ((root (alist-get 'path vault)))
                   (if (and (file-in-directory-p file root)
                            (or (not best) (> (length (file-truename root))
                                              (length (file-truename (alist-get 'path best))))))
                       vault
                     best)))
               vaults :initial-value nil)))

(defun noteriv--vault ()
  (let ((vaults (noteriv--json '("vaults" "--json"))))
    (if noteriv-vault
        (or (cl-find noteriv-vault vaults :key (lambda (v) (alist-get 'id v)) :test #'equal)
            (let ((named (cl-remove-if-not
                          (lambda (v) (equal (downcase noteriv-vault) (downcase (alist-get 'name v))))
                          vaults)))
              (if (cdr named) (noteriv--choose-vault named) (car named)))
            (cl-find (directory-file-name (expand-file-name noteriv-vault)) vaults
                     :key (lambda (v) (directory-file-name (alist-get 'path v))) :test #'equal)
            (user-error "Noteriv vault %S is unavailable.  Run noteriv-select-vault" noteriv-vault))
      (or (noteriv--containing-vault (or buffer-file-name default-directory) vaults)
          (cl-find-if (lambda (v) (alist-get 'active v)) vaults)
          (and (not (cdr vaults)) (car vaults))
          (noteriv--choose-vault vaults)))))

(defun noteriv--args (command vault options &rest operands)
  "Build CLI arguments with OPTIONS before the end-of-options marker."
  (append (list command "--vault" (alist-get 'id vault)) options
          (when operands (cons "--" operands))))

(defun noteriv--read-note (vault prompt)
  (let ((notes (noteriv--json (noteriv--args "list" vault '("--json")))))
    (unless notes (user-error "There are no notes in this vault"))
    (completing-read prompt notes nil t)))

(defun noteriv--local-note (vault note)
  (let* ((root (alist-get 'path vault))
         (file (expand-file-name (concat "./" note) root)))
    (unless (and (file-regular-p file) (file-in-directory-p file root))
      (user-error "Not a local note in this vault: %s" note))
    file))

;;;###autoload
(defun noteriv-select-vault ()
  "Choose a registered vault for subsequent commands in this Emacs session."
  (interactive)
  (let ((vault (noteriv--choose-vault (noteriv--json '("vaults" "--json")))))
    (setq noteriv-vault (alist-get 'id vault))
    (message "Noteriv vault: %s" (alist-get 'name vault))))

;;;###autoload
(defun noteriv-find-note ()
  "Choose a Noteriv note and open it in Emacs."
  (interactive)
  (let ((vault (noteriv--vault)))
    (find-file (noteriv--local-note vault (noteriv--read-note vault "Noteriv note: ")))))

(defun noteriv--search-choices (result)
  (cl-mapcan
   (lambda (file)
     (let ((path (alist-get 'relativePath file))
           (lines (alist-get 'lines file)))
       (if lines
           (mapcar (lambda (hit)
                     (let ((line (alist-get 'line hit)))
                       (cons (format "%s:%d  %s" path line
                                     (string-trim (alist-get 'text hit)))
                             (cons path line))))
                   lines)
         (list (cons path (cons path nil))))))
   (alist-get 'files result)))

;;;###autoload
(defun noteriv-search (query)
  "Search the vault using Noteriv QUERY syntax and jump to a result."
  (interactive (list (read-string "Noteriv search: ")))
  (when (string-blank-p query) (user-error "Enter a Noteriv search query"))
  (let* ((vault (noteriv--vault))
         (result (noteriv--json (noteriv--args "search" vault '("--json") query)))
         (choices (noteriv--search-choices result)))
    (unless choices (user-error "No matching notes"))
    (let* ((hit (cdr (assoc (completing-read "Noteriv result: " choices nil t) choices)))
           (line (cdr hit)))
      (find-file (noteriv--local-note vault (car hit)))
      (when line
        (widen)
        (goto-char (point-min))
        (forward-line (1- line))))))

;;;###autoload
(defun noteriv-create-note (name &optional text)
  "Create NAME using Noteriv and visit it in Emacs.
Interactively, use the active region as TEXT when there is one."
  (interactive
   (let ((text (when (use-region-p)
                 (buffer-substring-no-properties (region-beginning) (region-end)))))
     (list (read-string "New note (vault-relative path): ") text)))
  (let* ((vault (noteriv--vault))
         (note (string-trim-right
                (noteriv--call (noteriv--args "create" vault (when text '("--stdin")) name) text)
                "[\r\n]+")))
    (find-file (noteriv--local-note vault note))))

;;;###autoload
(defun noteriv-capture (text &optional choose-note)
  "Append TEXT to `noteriv-inbox'.  With prefix CHOOSE-NOTE, ask where.
Use the active region when capturing interactively, or prompt for text."
  (interactive (list (if (use-region-p)
                         (buffer-substring-no-properties (region-beginning) (region-end))
                       (read-string "Capture in Noteriv: "))
                     current-prefix-arg))
  (let* ((vault (noteriv--vault))
         (note (if (and noteriv-inbox (not choose-note))
                   noteriv-inbox
                 (noteriv--read-note vault "Capture in note: ")))
         (file (noteriv--local-note vault note))
         (buffer (find-buffer-visiting file)))
    (when (and buffer (buffer-modified-p buffer))
      (user-error "Save %s before appending to it" note))
    (noteriv--call (noteriv--args "append" vault '("--stdin") note) text)
    (when (and (buffer-live-p buffer) (not (buffer-modified-p buffer)))
      (with-current-buffer buffer (revert-buffer t t t)))
    (message "Captured in %s" note)))

(defun noteriv--app (args)
  (let ((default-directory temporary-file-directory))
    (make-process
     :name "noteriv-app" :command (cons (noteriv--program) args)
     :connection-type 'pipe :noquery t
     :sentinel (lambda (process event)
                 (when (or (eq (process-status process) 'signal)
                           (and (eq (process-status process) 'exit)
                                (/= 0 (process-exit-status process))))
                   (message "Noteriv: %s" (string-trim event)))))))

;;;###autoload
(defun noteriv-open-in-app (&optional choose-note)
  "Open the current vault note at point in Noteriv's window.
With prefix CHOOSE-NOTE or outside the vault, choose a note instead."
  (interactive "P")
  (let* ((vault (noteriv--vault))
         (root (alist-get 'path vault))
         (in-vault (and (not choose-note) buffer-file-name
                        (not (file-remote-p buffer-file-name))
                        (file-in-directory-p buffer-file-name root)))
         (note (if in-vault buffer-file-name (noteriv--read-note vault "Open in Noteriv: "))))
    (noteriv--app (noteriv--args "open" vault
                                (when in-vault (list "--line" (number-to-string (line-number-at-pos nil t))))
                                note))))

;;;###autoload
(defun noteriv-daily ()
  "Open today's daily note in Noteriv for the selected vault."
  (interactive)
  (noteriv--app (noteriv--args "daily" (noteriv--vault) nil)))

(defvar noteriv-command-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "v") #'noteriv-select-vault)
    (define-key map (kbd "f") #'noteriv-find-note)
    (define-key map (kbd "s") #'noteriv-search)
    (define-key map (kbd "n") #'noteriv-create-note)
    (define-key map (kbd "c") #'noteriv-capture)
    (define-key map (kbd "o") #'noteriv-open-in-app)
    (define-key map (kbd "d") #'noteriv-daily)
    map)
  "Keymap for Noteriv commands.")

;;;###autoload
(define-minor-mode noteriv-mode
  "Enable the global C-c n prefix for Noteriv commands."
  :global t
  :keymap (let ((map (make-sparse-keymap)))
            (define-key map (kbd "C-c n") noteriv-command-map)
            map))

(provide 'noteriv)
;;; noteriv.el ends here
