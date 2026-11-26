'use strict';

// Fixed visit budgets keep crowded or coincident clouds bounded.
module.exports = function neighborhood(points) {
  function partition(rows, depth) {
    if (!rows.length) return null;
    const axis = depth % 3;
    rows.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
    const middle = rows.length >> 1;
    return { id: rows[middle], axis,
      left: partition(rows.slice(0, middle), depth + 1), right: partition(rows.slice(middle + 1), depth + 1) };
  }
  const tree = partition(Array.from(points.keys()), 0);
  return (at, limit, { exclude = -1, radius = Infinity, coincident = true, accept } = {}) => {
    const nearest = [], maxVisits = 768, radius2 = radius ** 2;
    let visits = 0, limited = false;
    function search(node) {
      if (!node) return;
      if (visits >= maxVisits) { limited = true; return; }
      visits++;
      const p = points[node.id], delta = at[node.axis] - p[node.axis];
      const first = delta < 0 ? node.left : node.right, second = delta < 0 ? node.right : node.left;
      search(first);
      if (node.id !== exclude) {
        const distance = (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
        if (distance <= radius2 && (coincident || distance > 0) &&
            (nearest.length < limit || distance <= nearest.at(-1).distance) && (!accept || accept(node.id))) {
          const i = nearest.findIndex(hit => hit.distance > distance || (hit.distance === distance && hit.row > node.id));
          nearest.splice(i < 0 ? nearest.length : i, 0, { row: node.id, distance });
          if (nearest.length > limit) nearest.pop();
        }
      }
      const reach = nearest.length < limit ? radius2 : nearest.at(-1).distance;
      if (delta ** 2 <= reach) search(second);
    }
    search(tree);
    return { nearest, limited, visits };
  };
};
