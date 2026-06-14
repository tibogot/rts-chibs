// Placeholder loader - this will be replaced by the actual inline game script
// For now, fetch and execute the inline module from the HTML

(async () => {
  try {
    const response = await fetch(window.location.href);
    const html = await response.text();

    // Extract the inline script content (backup: fallback to inline if fetch fails)
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (match && match[1]) {
      // Create and execute the script in the current module context
      const script = document.createElement("script");
      script.type = "module";
      script.textContent = match[1];
      document.body.appendChild(script);
    }
  } catch (err) {
    console.error("Failed to load game script:", err);
  }
})();
