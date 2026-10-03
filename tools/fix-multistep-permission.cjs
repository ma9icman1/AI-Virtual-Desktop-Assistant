const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'App.tsx');
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  [
`      stopExecutionRef.current = false;
      setAssistantState("executing");
      setShowActivityPanel(true);

      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];`,
`      stopExecutionRef.current = false;
      setAssistantState("executing");
      setShowActivityPanel(true);

      // A multi-step voice command is one approved desktop operation. If the
      // user chose "one action", temporarily scope that approval to the whole
      // plan so step 1 cannot consume it before step 2 (vision/UI automation).
      const planUsesOneActionPermission = permissionLevel === "one_action";
      if (planUsesOneActionPermission) {
        setDesktopPermission("one_session");
      }

      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];`
  ],
  [
`      if (!steps.length) {
        setAssistantState("error");
        setShowActivityPanel(false);
        VoiceEngine.speak("The assistant created an empty desktop action plan.", () => setAssistantState("idle"));
        return;
      }`,
`      if (!steps.length) {
        if (planUsesOneActionPermission) setDesktopPermission("none");
        setAssistantState("error");
        setShowActivityPanel(false);
        VoiceEngine.speak("The assistant created an empty desktop action plan.", () => setAssistantState("idle"));
        return;
      }`
  ],
  [
`          setAssistantState("error");
          setShowActivityPanel(false);
          VoiceEngine.speak(\`Desktop control stopped: \${reason}\`, () => setAssistantState("idle"));
          return;`,
`          if (planUsesOneActionPermission) setDesktopPermission("none");
          setAssistantState("error");
          setShowActivityPanel(false);
          VoiceEngine.speak(\`Desktop control stopped: \${reason}\`, () => setAssistantState("idle"));
          return;`
  ],
  [
`      setAssistantState("speaking");
      const completionText = plan.spokenCompletion || "I have completed all steps in the plan.";`,
`      if (planUsesOneActionPermission) setDesktopPermission("none");
      setAssistantState("speaking");
      const completionText = plan.spokenCompletion || "I have completed all steps in the plan.";`
  ],
  [
`    [executeDesktopAction]
  );`,
`    [executeDesktopAction, permissionLevel, setDesktopPermission]
  );`
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
