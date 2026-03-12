document.addEventListener('DOMContentLoaded', () => {
  const filterForms = document.querySelectorAll('[data-local-filter]');

  filterForms.forEach((form) => {
    const input = form.querySelector('input[type="search"]');
    const targetSelector = form.dataset.target;
    const emptySelector = form.dataset.empty;
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    const empty = emptySelector ? document.querySelector(emptySelector) : null;

    if (!input || !target) return;

    const items = Array.from(target.querySelectorAll('[data-filter-item]'));

    const applyFilter = () => {
      const keyword = input.value.trim().toLowerCase();
      let visibleCount = 0;

      items.forEach((item) => {
        const haystack = (item.dataset.filterText || item.textContent || '').toLowerCase();
        const matched = !keyword || haystack.includes(keyword);
        item.hidden = !matched;
        if (matched) visibleCount += 1;
      });

      if (empty) {
        empty.hidden = visibleCount !== 0;
      }
    };

    input.addEventListener('input', applyFilter);
    applyFilter();
  });
});