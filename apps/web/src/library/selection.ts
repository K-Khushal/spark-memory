/** Selection uses wall order, never the subset currently mounted by virtualisation. */
export type Selection = { ids: string[]; anchor?: string };
export const emptySelection: Selection = { ids: [] };
export type SelectionAction =
  | { type: "toggle" | "range" | "only"; id: string }
  | { type: "all" }
  | { type: "clear" }
  /** Drops ids that are no longer on the wall. */
  | { type: "prune" }
  | { type: "marquee"; ids: string[]; additive?: string[] };
export function select(
  state: Selection,
  order: readonly string[],
  action: SelectionAction
): Selection {
  if (action.type === "clear") return emptySelection;
  if (action.type === "prune") {
    const onWall = new Set(order);
    const ids = state.ids.filter((id) => onWall.has(id));
    return ids.length === state.ids.length
      ? state
      : {
          ids,
          anchor:
            state.anchor && onWall.has(state.anchor) ? state.anchor : undefined,
        };
  }
  if (action.type === "all") return { ids: [...order], anchor: order[0] };
  if (action.type === "marquee") {
    const ids = new Set([...action.ids, ...(action.additive ?? [])]);
    return { ids: order.filter((id) => ids.has(id)), anchor: state.anchor };
  }
  if (!order.includes(action.id)) return state;
  if (action.type === "range") {
    const start = order.indexOf(state.anchor ?? action.id);
    const end = order.indexOf(action.id);
    return {
      anchor: order[start < 0 ? end : start],
      ids: order.slice(
        Math.min(start < 0 ? end : start, end),
        Math.max(start, end) + 1
      ),
    };
  }
  const ids = new Set(action.type === "only" ? [] : state.ids);
  if (ids.has(action.id)) ids.delete(action.id);
  else ids.add(action.id);
  return { ids: order.filter((id) => ids.has(id)), anchor: action.id };
}
