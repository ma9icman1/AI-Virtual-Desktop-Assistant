const fs = require("fs");
const path = require("path");

const appFile = path.join(process.cwd(), "src", "App.tsx");
const serverFile = path.join(process.cwd(), "server.ts");

if (fs.existsSync(appFile)) {
  let text = fs.readFileSync(appFile, "utf8");

  // VisionService uses { imageBase64, prompt } for /api/vision/analyze.
  text = text.replace(
    'body: JSON.stringify({ imageData, instruction:',
    'body: JSON.stringify({ imageBase64: imageData, prompt:'
  );

  // Accept the common alternate response property too.
  text = text.replace(
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : [];',
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);'
  );

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

  // Dynamic vision click: re-scan the current screen immediately before clicking.
  // This makes coordinates work after navigation, rather than using stale coordinates.
  if (!text.includes('normalizedType === "VISION_CLICK_TARGET"')) {
    const marker = '    const mapped = actions[normalizedType];';
    const injection = [
      '    if (normalizedType === "VISION_CLICK_TARGET") {',
      '      const imageData = await VisionService.captureScreen();',
      '      console.log("[VISION CLICK TARGET] screenshot captured", { bytes: imageData?.length || 0, targetLabel: params.targetLabel });',
      '      const response = await fetch("/api/vision/analyze", {',
      '        method: "POST",',
      '        headers: { "Content-Type": "application/json" },',
      '        body: JSON.stringify({',
      '          imageBase64: imageData,',
      '          prompt: "Identify the exact visible clickable input/control matching this target. Return detectedElements with label, type, boundingBox, and center coordinates in screenshot pixels. Prefer the search box/search bar when the target mentions search. Do not guess coordinates."',
      '        }),',
      '      });',
      '      if (!response.ok) throw new Error("Vision analysis failed while locating the target control.");',
      '      const vision = await response.json();',
      '      const elements = Array.isArray(vision?.detectedElements)',
      '        ? vision.detectedElements',
      '        : (Array.isArray(vision?.elements) ? vision.elements : []);',
      '      const targetLabel = String(params.targetLabel || "search").toLowerCase();',
      '      const targetWords = targetLabel.split(/[^a-z0-9]+/).filter(Boolean);',
      '      const target = elements.find((element: any) => {',
      '        const label = String(element?.label || "").toLowerCase();',
      '        const type = String(element?.type || "").toLowerCase();',
      '        if (!label && !type) return false;',
      '        if (targetWords.includes("search") && /search|query|find/.test(label + " " + type)) return true;',
      '        return targetWords.some((word) => label.includes(word) || type.includes(word));',
      '      });',
      '      const point = target?.center || (target?.boundingBox',
      '        ? {',
      '            x: target.boundingBox.x + target.boundingBox.width / 2,',
      '            y: target.boundingBox.y + target.boundingBox.height / 2,',
      '          }',
      '        : null);',
      '      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {',
      '        throw new Error(`Vision could not find the visible ${params.targetLabel || "target control"}.`);',
      '      }',
      '      console.log("[VISION CLICK TARGET] matched", { label: target?.label, type: target?.type, point });',
      '      if (!(window as any).magicDesktop?.execute) throw new Error("Desktop control is unavailable in this app window.");',
      '      return await (window as any).magicDesktop.execute("CLICK", {',
      '        x: point.x,',
      '        y: point.y,',
      '        coordinateSpace: "vision",',
      '      });',
      '    }',
      '',
    ].join("\n");
    if (text.includes(marker)) text = text.replace(marker, injection + marker);
  }

  fs.writeFileSync(appFile, text, "utf8");
  console.log("[vision-click-v2] App vision fixes applied.");
}

if (fs.existsSync(serverFile)) {
  let server = fs.readFileSync(serverFile, "utf8");

  // Handle commands like: "click the search bar and type magic" before the generic
  // SEARCH_WEB parser can mistake "bar and type magic" for a web-search query.
  if (!server.includes("const searchFieldCommandMatch = commandText.match")) {
    const marker = "  if (webSearchMatch) {";
    const injection = [
      '  const searchFieldCommandMatch = commandText.match(',
      '    /\\b(?:click|go\\s+to|focus|use)\\s+(?:the\\s+)?(?:search|address|query|text)\\s+(?:box|bar|field)\\b[\\s\\S]*?\\b(?:type|enter|search)\\s+(?:for\\s+)?["\']?(.+?)["\']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i',
      '  );',
      '',
      '  if (searchFieldCommandMatch) {',
      '    const query = searchFieldCommandMatch[1].trim();',
      '    return {',
      '      ...parsed,',
      '      spokenResponse: `I will find the visible search field, enter ${query}, and submit it.`,',
      '      spokenReply: `I will find the visible search field, enter ${query}, and submit it.`,',
      '      action: {',
      '        type: "MULTI_STEP_PLAN",',
      '        description: `Use the live screen to find the search field and enter ${query}`,',
      '        multiStepPlan: {',
      '          planTitle: "Find search field",',
      '          spokenIntro: `I will analyze the current screen, click the search field, and search for ${query}.`,',
      '          steps: [',
      '            { stepNumber: 1, description: "Analyze the live screen and click the search field", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },',
      '            { stepNumber: 2, description: `Type ${query}`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },',
      '            { stepNumber: 3, description: "Submit the search", actionType: "KEY_PRESS", params: { key: "~" }, status: "pending", estimatedDurationMs: 300 },',
      '          ],',
      '          spokenCompletion: "The search was submitted.",',
      '          currentStepIndex: 0,',
      '          status: "idle",',
      '        },',
      '      },',
      '    };',
      '  }',
      '',
    ].join("\n");
    if (server.includes(marker)) server = server.replace(marker, injection + marker);
  }

  // Handle: "open roblox.com and search for magic" as one plan. The search target
  // is located with a fresh vision scan after navigation.
  if (!server.includes("const websiteSearchMatch = commandText.match")) {
    const marker = "  if (webSearchMatch) {";
    const injection = [
      '  const websiteSearchMatch = commandText.match(',
      '    /\\b(?:open|go\\s+to|navigate\\s+to|visit|load|browse\\s+to|goto)\\s*(?:https?:\\/\\/)?((?:www\\.)?[a-z0-9-]+\\.[a-z]{2,})\\s+(?:and\\s+)?(?:search|look\\s+up)\\s+(?:for\\s+)?["\']?(.+?)["\']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?\\s*$/i',
      '  );',
      '',
      '  if (websiteSearchMatch) {',
      '    const host = websiteSearchMatch[1];',
      '    const query = websiteSearchMatch[2].trim();',
      '    const url = `https://${host}`;',
      '    return {',
      '      ...parsed,',
      '      spokenResponse: `Opening ${host}, finding its search box, and searching for ${query}.`,',
      '      spokenReply: `Opening ${host}, finding its search box, and searching for ${query}.`,',
      '      action: {',
      '        type: "MULTI_STEP_PLAN",',
      '        description: `Open ${host} and search the page for ${query}`,',
      '        multiStepPlan: {',
      '          planTitle: `Open ${host} and search`,',
      '          spokenIntro: `I will open ${host}, analyze the page, click its search box, and search for ${query}.`,',
      '          steps: [',
      '            { stepNumber: 1, description: `Open ${url}`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },',
      '            { stepNumber: 2, description: "Analyze the live page and click its search box", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },',
      '            { stepNumber: 3, description: `Type ${query}`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },',
      '            { stepNumber: 4, description: "Submit the search", actionType: "KEY_PRESS", params: { key: "~" }, status: "pending", estimatedDurationMs: 300 },',
      '          ],',
      '          spokenCompletion: `I searched ${host} for ${query}.`,',
      '          currentStepIndex: 0,',
      '          status: "idle",',
      '        },',
      '      },',
      '    };',
      '  }',
      '',
    ].join("\n");
    if (server.includes(marker)) server = server.replace(marker, injection + marker);
  }

  // Contextual in-site search: when the user names a site/app, SEARCH_WEB must
  // never take over. Open the named site, then re-scan the live screen for its
  // search control, type the query, and submit it.
  if (!server.includes("const contextualSiteSearchMatch = commandText.match")) {
    const marker = "  if (webSearchMatch) {";
    const injection = [
      '  const contextualSiteSearchMatch = commandText.match(',
      '    /^(?:please\\s+)?(?:(?:open|go\\s+to|navigate\\s+to|visit|load|browse\\s+to)\\s+)?(roblox(?:\\.com)?|youtube(?:\\.com)?|amazon(?:\\.com)?|ebay(?:\\.com)?|reddit(?:\\.com)?|discord(?:\\.com)?|facebook(?:\\.com)?|instagram(?:\\.com)?|tiktok(?:\\.com)?|twitter(?:\\.com)?|x(?:\\.com)?)\\s+(?:and\\s+(?:then\\s+)?)?(?:search|look\\s+up)\\s+(?:on\\s+)?(?:for\\s+)?["\\\']?(.+?)["\\\']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?$/i',
      '  );',
      '  const searchOnSiteMatch = commandText.match(',
      '    /^(?:please\\s+)?(?:search|look\\s+up)\\s+(?:on|in|using)\\s+(roblox(?:\\.com)?|youtube(?:\\.com)?|amazon(?:\\.com)?|ebay(?:\\.com)?|reddit(?:\\.com)?|discord(?:\\.com)?|facebook(?:\\.com)?|instagram(?:\\.com)?|tiktok(?:\\.com)?|twitter(?:\\.com)?|x(?:\\.com)?)\\s+(?:for\\s+)?["\\\']?(.+?)["\\\']?(?:\\s+(?:and\\s+)?(?:press|hit)\\s+enter)?$/i',
      '  );',
      '',
      '  const siteSearch = contextualSiteSearchMatch || searchOnSiteMatch;',
      '  if (siteSearch) {',
      '    const host = String(siteSearch[1]).replace(/\\.com$/i, "") + ".com";',
      '    const query = String(siteSearch[2]).trim().replace(/[.!?]+$/g, "");',
      '    const url = `https://${host}/`;',
      '    return {',
      '      ...parsed,',
      '      spokenResponse: `Opening ${host}, finding its search box, and searching for ${query}.`,',
      '      spokenReply: `Opening ${host}, finding its search box, and searching for ${query}.`,',
      '      action: {',
      '        type: "MULTI_STEP_PLAN",',
      '        description: `Open ${host} and search it for ${query}`,',
      '        multiStepPlan: {',
      '          planTitle: `Search ${host}`,',
      '          spokenIntro: `I will open ${host}, analyze the current screen, find its search box, and search for ${query}.`,',
      '          steps: [',
      '            { stepNumber: 1, description: `Open ${url}`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },',
      '            { stepNumber: 2, description: "Find the named site search box on the live screen", actionType: "VISION_CLICK_TARGET", params: { targetLabel: "search bar" }, status: "pending", estimatedDurationMs: 900 },',
      '            { stepNumber: 3, description: `Type ${query}`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },',
      '            { stepNumber: 4, description: "Submit the site search", actionType: "KEY_PRESS", params: { key: "~" }, status: "pending", estimatedDurationMs: 300 },',
      '          ],',
      '          spokenCompletion: `I searched ${host} for ${query}.`,',
      '          currentStepIndex: 0,',
      '          status: "idle",',
      '        },',
      '      },',
      '    };',
      '  }',
      '',
    ].join("\n");
    if (server.includes(marker)) server = server.replace(marker, injection + marker);
  }

  fs.writeFileSync(serverFile, server, "utf8");
  console.log("[vision-click-v2] Server voice-intent fixes applied.");
}
