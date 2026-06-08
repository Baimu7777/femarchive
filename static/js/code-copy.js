document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".article-content pre").forEach((pre) => {
      if (pre.closest(".code-block")) return;
  
      const code = pre.querySelector("code");
      if (!code) return;
  
      const highlight = pre.closest(".highlight");
      const target = highlight || pre;
  
      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
  
      target.parentNode.insertBefore(wrapper, target);
  
      const toolbar = document.createElement("div");
      toolbar.className = "code-block__toolbar";
  
      const languageClass = [...code.classList].find((className) =>
        className.startsWith("language-")
      );
  
      const language = languageClass
        ? languageClass.replace("language-", "").toUpperCase()
        : "TEXT";
  
      const label = document.createElement("span");
      label.className = "code-block__language";
      label.textContent = language;
  
      const button = document.createElement("button");
      button.className = "code-block__copy";
      button.type = "button";
      button.textContent = "复制";
  
      button.addEventListener("click", async () => {
        const content = code.innerText;
  
        try {
          await navigator.clipboard.writeText(content);
        } catch (error) {
          const textarea = document.createElement("textarea");
          textarea.value = content;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
  
        button.textContent = "已复制";
        button.classList.add("is-copied");
  
        window.setTimeout(() => {
          button.textContent = "复制";
          button.classList.remove("is-copied");
        }, 1600);
      });
  
      toolbar.append(label, button);
      wrapper.append(toolbar, target);
    });
  });