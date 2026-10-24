// The fixed, heavily blurred background that tints every glass surface.

let currentUrl = "";

export function setAmbient(url) {
  const root = document.querySelector(".ambient");
  const layer = root?.querySelector(".ambient-img");
  if (!layer || url === currentUrl) return;
  currentUrl = url;
  if (!url) return root.classList.remove("on");
  const pre = new Image();
  pre.onload = () => {
    if (currentUrl !== url) return;
    layer.style.backgroundImage = `url("${url}")`;
    root.classList.add("on");
  };
  pre.src = url;
}
