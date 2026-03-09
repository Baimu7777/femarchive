document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("search-input");
  const meta = document.getElementById("search-meta");
  const results = document.getElementById("search-results");

  if (!input || !meta || !results) return;

  let records = [];

  const normalize = (value) => (value || "").toString().trim().toLowerCase();
  const arrayText = (value) => Array.isArray(value) ? value.join(" ") : "";

  const render = (items, keyword) => {
    if (!keyword) {
      meta.textContent = "输入关键词后开始搜索。";
      results.innerHTML = "";
      return;
    }

    meta.textContent = `找到 ${items.length} 条结果`;

    if (!items.length) {
      results.innerHTML = '<div class="empty-state">没有匹配结果。</div>';
      return;
    }

    results.innerHTML = items.map(item => {
      const tags = (item.tags || []).map(tag => `<span class="pill">${tag}</span>`).join("");
      return `
        <article class="search-card">
          <div class="article-meta-row">
            <time datetime="${item.date}">${item.date}</time>
          </div>
          <h3><a href="${item.url}">${item.title}</a></h3>
          <p>${item.description || item.summary || ""}</p>
          <div class="term-list compact">${tags}</div>
        </article>
      `;
    }).join("");
  };

  const search = (keyword) => {
    const q = normalize(keyword);
    if (!q) return render([], "");

    const scored = records.map(item => {
      const title = normalize(item.title);
      const description = normalize(item.description);
      const summary = normalize(item.summary);
      const content = normalize(item.content);
      const tags = normalize(arrayText(item.tags));
      const categories = normalize(arrayText(item.categories));
      const keywords = normalize(arrayText(item.keywords));

      let score = 0;
      if (title.includes(q)) score += 5;
      if (tags.includes(q)) score += 4;
      if (keywords.includes(q)) score += 4;
      if (categories.includes(q)) score += 3;
      if (description.includes(q)) score += 2;
      if (summary.includes(q)) score += 2;
      if (content.includes(q)) score += 1;

      return { ...item, score };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.date) - new Date(a.date));

    render(scored, q);
  };

  try {
    const response = await fetch("/index.json");
    records = await response.json();
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("q") || "";
    input.value = initial;
    search(initial);
  } catch (error) {
    meta.textContent = "搜索索引加载失败。";
  }

  input.addEventListener("input", (event) => {
    const value = event.target.value;
    const url = new URL(window.location.href);
    if (value.trim()) {
      url.searchParams.set("q", value.trim());
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState({}, "", url);
    search(value);
  });
});
