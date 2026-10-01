const fs = require("fs");
const path = require("path");

const appFile = path.join(process.cwd(), "src", "App.tsx");
const serverFile = path.join(process.cwd(), "server.ts");

if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, "utf8");

  // The first vision-click patch sent the wrong field names to /api/vision/analyze.
  // VisionService uses { imageBase64, prompt }; keep the click resolver consistent.
  text = text.replace(
    'body: JSON.stringify({ imageData, instruction:',
    'body: JSON.stringify({ imageBase64: imageData, prompt:'
  );

  // Accept the common alternate response property too, without changing the public VisionDetection type.
  text = text.replace(
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : [];',
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);'
  );

  // Add explicit diagnostics so failures tell us whether capture, vision, matching, or clicking failed.
  if (!text.includes('[VISION CLICK] screenshot captured')) {
    text = text.replace(
      'const imageData = await VisionService.captureScreen();',
      'const imageData = await VisionService.captureScreen();\n          console.log("[VISION CLICK] screenshot captured", { bytes: imageData?.length || 0 });'
    );
  }

  if (!text.includes('[VISION CLICK] vision elements')) {
    text = text.replace(
      'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);',
      'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);\n          console.log("[VISION CLICK] vision elements", elements.length, elements.map((e: any) => ({ label: e?.label, type: e?.type, center: e?.center, boundingBox: e?.boundingBox })));'
    );
  }

  // Dynamic vision action: re-scan the live screen immediately before clicking a target.
  // This is required for commands like "open roblox.com and search for magic" because
  // the coordinates cannot be known until the newly opened page is visible.
  if (!text.includes('normalizedType === "VISION_CLICK_TARGET"')) {
    const marker = '    const mapped = actions[normalizedType];';
    const injection = `    if (normalizedType === "VISION_CLICK_TARGET") {
      const imageData = await VisionService.captureScreen();
      console.log("[VISION CLICK TARGET] screenshot captured", { bytes: imageData?.length || 0, targetLabel: params.targetLabel });
      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData,
          prompt: "Identify the exact visible clickable input/control matching this target. Return detectedElements with label, type, boundingBox, and center coordinates in screenshot pixels. Prefer the search box/search bar when the target mentions search. Do not guess coordinates."
        }),
      });
      if (!response.ok) throw new Error("Vision analysis failed while locating the target control.");
      const vision = await response.json();
      const elements = Array.isArray(vision?.detectedElements)
        ? vision.detectedElements
        : (Array.isArray(vision?.elements) ? vision.elements : []);
      const targetLabel = String(params.targetLabel || "search").toLowerCase();
      const targetWords = targetLabel.split(/[^a-z0-9]+/).filter(Boolean);
      const target = elements.find((element: any) => {
        const label = String(element?.label || "").toLowerCase();
        const type = String(element?.type || "").toLowerCase();
        if (!label && !type) return false;
        if (targetWords.includes("search") && /search|query|find/.test(label + " " + type)) return true;
        return targetWords.some((word) => label.includes(word) || type.includes(word));
      });
      const point = target?.center || (target?.boundingBox
        ? {
            x: target.boundingBox.x + target.boundingBox.width / 2,
            y: target.boundingBox.y + target.boundingBox.height / 2,
          }
        : null);
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        throw new Error(\`Vision could not find the visible \\${params.targetLabel || "target control"}.\`);
      }
      console.log("[VISION CLICK TARGET] matched", { label: target?.label, type: target?.type, point });
      if (!(window as any).magicDesktop?.execute) throw new Error("Desktop control is unavailable in this app window.");
      return await (window as any).magicDesktop.execute("CLICK", {
        x: point.x,
        y: point.y,
        coordinateSpace: "vision",
      });
    }

`;
    if (!text.includes(marker)) {
      console.warn("[vision-click-v2] Could not find executeDesktopAction insertion point.");
    } else {
      text = text.replace(marker, injection + marker);
    }
  }

  fs.writeFileSync(appFile, text, "utf8");
  console.log("[vision-click-v2] Vision click fixes applied.");
}

if (fs.existsSync(serverFile)) {
  let server = fs.readFileSync(serverFile, "utf8");

  // Prevent phrases such as "click the search bar ... and type magic" from being
  // misclassified by the generic SEARCH_WEB parser.
  if (!server.includes("const visibleInputMatch = message.match")) {
    console.warn("[vision-click-v2] Expected visible-input parser was not found in server.ts.");
  }

  // Combined website + in-page search command. The second step uses live vision
  // after navigation instead of guessing browser coordinates.
  if (!server.includes("const websiteSearchMatch = commandText.match")) {
    const marker = "  if (webSearchMatch) {";
    const injection = `  const websiteSearchMatch = commandText.match(
    /\\b(?:open|go\\s+to|navigate\\s+to|visit|load|browse\\s+to|goto)\\s*(?:https?:\\/\\/)?((?:www\\.)?[a-z0-9-]+\\.[a-z]{2,})\\s+(?:and\\s+)?(?:search|look\\s+up)\\s+(?:for\\s+)?[\\"']?(.+?)[\\"']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i
  );

  if (websiteSearchMatch) {
    const host = websiteSearchMatch[1];
    const query = websiteSearchMatch[2].trim();
    const url = \`https://\${host}\`;
    return {
      ...parsed,
      spokenResponse: \`Opening \${host}, finding its search box, and searching for \${query}.\`,
      spokenReply: \`Opening \${host}, finding its search box, and searching for \${query}.\`,
      action: {
        type: "MULTI_STEP_PLAN",
        description: \`Open \${host} and search the page for \${query}\`,
        multiStepPlan: {
          planTitle: \`Open \${host} and search\`,
          spokenIntro: \`I will open \${host}, analyze the page, click its search box, and search for \${query}.\`,
          steps: [
            { stepNumber: 1, description: \`Open \${url}\`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
            { stepNumber: 2, description: "Analyze the live page and click its search box", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },
            { stepNumber: 3, description: \`Type \${query}\`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },
            { stepNumber: 4, description: "Submit the search", actionType: "KEY_PRESS", params: { key: "~" }, status: "pending", estimatedDurationMs: 300 },
          ],
          spokenCompletion: \`I searched \${host} for \${query}.\`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

`;
    if (!server.includes(marker)) {
      console.warn("[vision-click-v2] Could not find SEARCH_WEB parser insertion point in server.ts.");
    } else {
      server = server.replace(marker, injection + marker);
    }
  }

  // Generic visible search-bar commands must run before the generic web-search
  // parser. Otherwise "click the search bar and type magic" becomes a Google search
  // for the words "bar and type magic".
  const visibleBlock = `  if (visibleInputMatch && targetPoint) {`;
  const webBlock = `  if (webSearchMatch) {`;
  if (server.indexOf(visibleBlock) > server.indexOf(webBlock)) {
    const visibleStart = server.indexOf(visibleBlock);
    const webStart = server.indexOf(webBlock);
    const visibleEnd = server.indexOf("\n  if (targetPoint &&", visibleStart);
    if (visibleStart >= 0 && webStart >= 0 && visibleEnd > visibleStart) {
      const visibleSection = server.slice(visibleStart, visibleEnd);
      server = server.slice(0, webStart) + visibleSection + "\n" + server.slice(webStart, visibleStart) + server.slice(visibleEnd);
    }
  }

  fs.writeFileSync(serverFile, server, "utf8");
  console.log("[vision-click-v2] Server voice-intent fixes applied.");
}
`;
    text = text.replace(marker, injection + marker);
    fs.writeFileSync(appFile, text, "utf8");
  }
}

console.log("[vision-click-v2] Vision click fixes applied.");
