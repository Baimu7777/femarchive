// Keep relationships scoped to their report page, including paginated replies.
export function groupReports(records) {
  const nodes = new Map();
  let anonymous = 0;
  const key = (path, id) => JSON.stringify([path, String(id)]);
  function collect(comment, path, parent) {
    const id = comment.objectId == null ? `missing-${++anonymous}` : String(comment.objectId);
    const identity = key(path, id);
    if (nodes.has(identity)) return;
    const node = {comment, path, id, parentId: comment.pid || parent?.id, rootId: comment.rid || parent?.rootId || parent?.id, replies: []};
    nodes.set(identity, node);
    for (const child of comment.children || []) collect(child, path, node);
  }
  records.forEach(({comment, path}) => collect(comment, path));
  const threads = [];
  for (const node of nodes.values()) {
    node.parent = node.parentId ? nodes.get(key(node.path, node.parentId)) : undefined;
    let root = node;
    const seen = new Set([node]);
    while (root.parentId || root.rootId) {
      const next = nodes.get(key(node.path, root.parentId)) || nodes.get(key(node.path, root.rootId));
      if (!next || seen.has(next)) break;
      seen.add(next); root = next;
    }
    // Invalid cycles stay visible rather than disappearing from the list.
    if (root !== node && !(root.parentId && seen.has(nodes.get(key(root.path, root.parentId))))) root.replies.push(node);
    else threads.push(node);
  }
  const time = node => new Date(node.comment.time).getTime() || 0;
  for (const thread of threads) thread.replies.sort((a,b) => time(a)-time(b));
  return threads.sort((a,b) => time(b)-time(a));
}
