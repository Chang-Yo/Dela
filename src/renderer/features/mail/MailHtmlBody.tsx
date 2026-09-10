import { useMemo, useState } from 'react';
import { prepareMailHtml, mailLinks } from './mail-html';
import styles from './MailView.module.css';

export function MailHtmlBody({ html, text }: { html: string; text: string | null }) {
  const [remoteImages, setRemoteImages] = useState(true);
  const [plain, setPlain] = useState(false);
  const [fitWidth, setFitWidth] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const document = useMemo(
    () => prepareMailHtml(html, remoteImages, fitWidth),
    [html, remoteImages, fitWidth],
  );
  const links = useMemo(() => mailLinks(html), [html]);
  return (
    <>
      <div className={styles.bodyToolbar}>
        <button type="button" aria-pressed={fitWidth} onClick={() => setFitWidth(!fitWidth)}>
          {fitWidth ? '适应宽度' : '原始布局'}
        </button>
        <button type="button" aria-pressed={plain} onClick={() => setPlain(!plain)}>
          纯文本
        </button>
        <button
          type="button"
          aria-pressed={remoteImages}
          onClick={() => setRemoteImages(!remoteImages)}
        >
          远程图片：{remoteImages ? '显示' : '隐藏'}
        </button>
        {links.length > 0 && (
          <details>
            <summary>正文链接（{links.length}）</summary>
            <ul>
              {links.map(({ label, url }) => (
                <li key={url}>
                  <a
                    href={url}
                    onClick={(event) => {
                      event.preventDefault();
                      setLinkError(null);
                      void window.dela?.mail
                        .openLink(url)
                        .catch(() => setLinkError('无法打开链接，请重试'));
                    }}
                  >
                    {label}
                    <small>{url}</small>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {linkError && (
        <p role="alert" className={styles.readingNotice}>
          {linkError}
        </p>
      )}
      {plain ? (
        <div className={styles.plainBody}>
          {text ?? new DOMParser().parseFromString(html, 'text/html').body.textContent}
        </div>
      ) : (
        <iframe
          className={styles.htmlBody}
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={document}
          title="邮件正文"
        />
      )}
    </>
  );
}
