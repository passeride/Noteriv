;;; noteriv-test.el --- Tests for noteriv.el -*- lexical-binding: t; -*-

(require 'ert)
(require 'noteriv)

(ert-deftest noteriv-cli-preserves-arguments-and-utf8-stdin ()
  (let ((shell (executable-find "sh")))
    (skip-unless shell)
    (cl-letf (((symbol-function 'noteriv--program) (lambda () shell)))
      (let ((text "Første linje\nAndre linje: æøå\n"))
        (should
         (equal (noteriv--call '("-c" "printf '<%s>\\n' \"$@\"; cat" "test"
                                  "--" "- [ ] A & B.md") text)
                (concat "<-->\n<- [ ] A & B.md>\n" text))))
      (should-error (noteriv--call '("-c" "printf 'failed' >&2; exit 2"))
                    :type 'user-error))))

(ert-deftest noteriv-takes-search-results-to-the-matching-line ()
  (let* ((dir (make-temp-file "noteriv-test-" t))
         (file (expand-file-name "Prosjekt Å.md" dir))
         (vault-id "vault-1")
         (noteriv-vault nil)
         calls)
    (unwind-protect
        (progn
          (write-region "Første\nAndre\nTre\n" nil file nil 'silent)
          (cl-letf (((symbol-function 'noteriv--call)
                     (lambda (args &optional _input)
                       (push args calls)
                       (pcase (car args)
                         ("vaults" (json-serialize (vector (list :id vault-id :path dir :name "Test" :active t))))
                         ("search" "{\"files\":[{\"relativePath\":\"Prosjekt Å.md\",\"lines\":[{\"line\":2,\"text\":\"Andre\"}]}]}")
                         (_ (error "Unexpected args: %S" args)))))
                    ((symbol-function 'completing-read)
                     (lambda (_prompt choices &rest _rest) (caar choices))))
            (save-window-excursion
              (noteriv-search "-query med mellomrom")
              (should (equal buffer-file-name file))
              (should (= (line-number-at-pos) 2))))
          (should (equal (car calls) (list "search" "--vault" vault-id "--json" "--" "-query med mellomrom"))))
      (when-let ((buffer (find-buffer-visiting file))) (kill-buffer buffer))
      (delete-directory dir t))))

(ert-deftest noteriv-capture-protects-unsaved-edits-and-refreshes-clean-buffers ()
  (let* ((dir (make-temp-file "noteriv-test-" t))
         (file (expand-file-name "Inbox.md" dir))
         (noteriv-inbox "Inbox.md")
         buffer)
    (unwind-protect
        (progn
          (write-region "Start\n" nil file nil 'silent)
          (setq buffer (find-file-noselect file))
          (cl-letf (((symbol-function 'noteriv--vault)
                     (lambda () (list (cons 'id "vault-1") (cons 'path dir))))
                    ((symbol-function 'noteriv--call)
                     (lambda (args &optional text)
                       (should (equal args '("append" "--vault" "vault-1" "--stdin" "--" "Inbox.md")))
                       (write-region text nil file t 'silent)
                       "Inbox.md\n")))
            (with-current-buffer buffer
              (goto-char (point-max))
              (insert "Unsaved")
              (should-error (noteriv-capture "Ny tekst\n") :type 'user-error)
              (revert-buffer t t t)
              (noteriv-capture "Ny tekst\n")
              (should (equal (buffer-string) "Start\nNy tekst\n")))))
      (when (buffer-live-p buffer) (kill-buffer buffer))
      (delete-directory dir t))))

(ert-deftest noteriv-opens-the-current-note-at-its-absolute-line ()
  (let* ((dir (make-temp-file "noteriv-test-" t))
         (file (expand-file-name "Some note.md" dir)))
    (unwind-protect
        (with-temp-buffer
          (write-region "" nil file nil 'silent)
          (setq buffer-file-name file)
          (insert "one\ntwo\nthree\n")
          (goto-char (point-min))
          (forward-line 2)
          (narrow-to-region (point) (point-max))
          (cl-letf (((symbol-function 'noteriv--vault)
                     (lambda () (list (cons 'id "vault-1") (cons 'path dir))))
                    ((symbol-function 'noteriv--app)
                     (lambda (args)
                       (should (equal args (list "open" "--vault" "vault-1" "--line" "3" "--" file))))))
            (noteriv-open-in-app)))
      (delete-directory dir t))))

;;; noteriv-test.el ends here
