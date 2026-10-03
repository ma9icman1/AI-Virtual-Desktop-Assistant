const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'App.tsx');
let text = fs.readFileSync(file, 'utf8');

const replacements = [
  [
`      stopExecutionRef.current = false;\n      setAssistantState("executing");\n      setShowActivityPanel(true);\n\n      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];`,
`      stopExecutionRef.current = false;\n      setAssistantState("executing");\n      setShowActivityPanel(true);\n\n      // A multi-step voice command is one approved desktop operation. If the\n      // user chose "one action", temporarily scope that approval to the whole\n      // plan so step 1 cannot consume it before step 2 (vision/UI automation).\n      const planUsesOneActionPermission = permissionLevel === "one_action";\n      if (planUsesOneActionPermission) {\n        setDesktopPermission("one_session");\n      }\n\n      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];`
  ],
  [
`      if (!steps.length) {\n        setAssistantState("error");\n        setShowActivityPanel(false);\n        VoiceEngine.speak("The assistant created an empty desktop action plan.", () => setAssistantState("idle"));\n        return;\n      }`,
`      if (!steps.length) {\n        if (planUsesOneActionPermission) setDesktopPermission("none");\n        setAssistantState("error");\n        setShowActivityPanel(false);\n        VoiceEngine.speak("The assistant created an empty desktop action plan.", () => setAssistantState("idle"));\n        return;\n      }`
  ],
  [
`          setAssistantState("error");\n          setShowActivityPanel(false);\n          VoiceEngine.speak(\`Desktop control stopped: \${reason}\`, () => setAssistantState("idle"));\n          return;`,
`          if (planUsesOneActionPermission) setDesktopPermission("none");\n          setAssistantState("error");\n          setShowActivityPanel(false);\n          VoiceEngine.speak(\`Desktop control stopped: \${reason}\`, () => setAssistantState("idle"));\n          return;`
  ],
  [
`      setAssistantState("speaking");\n      const completionText = plan.spokenCompletion || "I have completed all steps in the plan.";`,
`      if (planUsesOneActionPermission) setDesktopPermission("none");\n      setAssistantState("speaking");\n      const completionText = plan.spokenCompletion || "I have completed all steps in the plan.";`
  ],
  [
`    [executeDesktopAction]\n  );`,
`    [executeDesktopAction, permissionLevel, setDesktopPermission]\n  );`
  ]
];

for (const [from, to] of replacements) {
  if (!text.includes(from)) {
    throw new Error('Expected source marker was not found; refusing to make a partial edit.');
  }
  text = text.replace(from, to);
}

fs.writeFileSync(file, text, 'utf8');
console.log(`Patched ${file}`);
