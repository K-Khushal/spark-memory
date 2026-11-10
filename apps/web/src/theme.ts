// index.html sets data-theme before first paint (DESIGN.md → Colour). This
// keeps it following the system while the app is open, unless the person
// saved a choice under "spark-theme".
export function followSystemTheme() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("spark-theme");
    } catch {
      // Storage blocked: follow the system.
    }
    const dark = saved ? saved === "dark" : query.matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  query.addEventListener("change", apply);
}
