async function testVertexAI() {
  const projectId = "project-07fb439f-587f-47a6-b07";
  console.log("=== Vertex AI Test v2 ===\n");
  const { execSync } = require("child_process");
  let token;
  try {
    token = execSync("gcloud auth print-access-token", { encoding: "utf-8" }).trim();
    console.log("Token: " + token.substring(0, 15) + "...");
  } catch (e) {
    console.error("Token FAILED: " + e.message);
    return;
  }
  const tests = [
    {
      name: "gemini-2.5-flash (us-central1, text only)",
      url: "https://us-central1-aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }] }
    },
    {
      name: "gemini-2.5-flash-preview-04-17 (us-central1, text)",
      url: "https://us-central1-aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-04-17:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }] }
    },
    {
      name: "gemini-2.0-flash-exp (us-central1, image gen)",
      url: "https://us-central1-aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/us-central1/publishers/google/models/gemini-2.0-flash-exp:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }], generationConfig: { responseModalities: ["TEXT"] } }
    },
    {
      name: "gemini-2.5-flash (aiplatform.googleapis.com global)",
      url: "https://aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }] }
    },
    {
      name: "gemini-2.5-flash-image (aiplatform.googleapis.com global)",
      url: "https://aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/global/publishers/google/models/gemini-2.5-flash-image:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }], generationConfig: { responseModalities: ["TEXT"] } }
    },
    {
      name: "gemini-3-pro-image-preview (aiplatform.googleapis.com global)",
      url: "https://aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/global/publishers/google/models/gemini-3-pro-image-preview:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }], generationConfig: { responseModalities: ["TEXT"] } }
    },
    {
      name: "gemini-3.1-flash-image-preview (aiplatform.googleapis.com global)",
      url: "https://aiplatform.googleapis.com/v1/projects/" + projectId + "/locations/global/publishers/google/models/gemini-3.1-flash-image-preview:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "Say hello" }] }], generationConfig: { responseModalities: ["TEXT"] } }
    },
  ];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    console.log("\n" + (i+1) + ". " + t.name);
    try {
      const res = await fetch(t.url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(t.body),
      });
      const text = await res.text();
      console.log("   Status: " + res.status + (res.ok ? " OK" : " FAIL"));
      console.log("   " + text.substring(0, 250));
    } catch (e) {
      console.error("   Error: " + e.message);
    }
  }
  console.log("\n=== Done ===");
}
testVertexAI();