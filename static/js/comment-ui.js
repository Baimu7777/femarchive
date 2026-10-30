import { updateAnonymousAvatars } from './comment-avatars.js';

export function mountCommentControls(root, loginEntry) {
      let originalLogin;
      const simplifyControls = () => {
        const form = root.querySelector('.wl-comment');
        if (form?.parentElement && !form.parentElement.classList.contains('archive-comment-flow')) {
          form.parentElement.classList.add('archive-comment-flow');
        }
        updateAnonymousAvatars(root);
        for (const card of root.querySelectorAll('.wl-card')) {
          const content = card.querySelector(':scope > .wl-content');
          const reply = card.querySelector(':scope > .wl-head .wl-reply');
          if (content && reply) {
            let footer = content.querySelector(':scope > .wl-reply-footer');
            if (!footer) {
              footer = document.createElement('div');
              footer.className = 'wl-reply-footer';
              content.append(footer);
            }
            footer.append(reply);
          }
        }
        for (const item of root.querySelectorAll('li, button, [role="tab"]')) {
          if (item.textContent.trim() === '按热度') item.setAttribute('data-comment-hidden', '');
        }
        for (const button of root.querySelectorAll('button')) {
          const label = button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent.trim();
          if (label === '预览' || label === 'Preview') button.setAttribute('data-comment-hidden', '');
          if (label === '登录' || label === 'Login') {
            originalLogin = button;
            button.setAttribute('data-comment-hidden', '');
          }
        }
        for (const link of root.querySelectorAll('a[title="Markdown Guide"]')) link.setAttribute('data-comment-hidden', '');
        if (loginEntry) loginEntry.hidden = !originalLogin || !root.contains(originalLogin);
      };
      loginEntry?.addEventListener('click', () => originalLogin?.click());
      const observer = new MutationObserver(simplifyControls);
      observer.observe(root, { childList: true, subtree: true });
      simplifyControls();
      return () => observer.disconnect();
}
