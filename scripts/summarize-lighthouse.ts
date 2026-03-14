import { readFile } from "node:fs/promises";

async function summarize() {
  try {
    const data = JSON.parse(await readFile("./lighthouse.json", "utf-8"));

    // Extract Main Categories (0-100 scale)
    const categories = data.categories;
    const scores = {
      Performance: categories.performance.score * 100,
      Accessibility: categories.accessibility.score * 100,
      BestPractices: categories["best-practices"].score * 100,
      SEO: categories.seo.score * 100,
    };

    // Extract Core Web Vitals & Metrics
    const audits = data.audits;
    const metrics = {
      FCP: audits["first-contentful-paint"].displayValue,
      LCP: audits["largest-contentful-paint"].displayValue,
      TBT: audits["total-blocking-time"].displayValue,
      CLS: audits["cumulative-layout-shift"].displayValue,
      SpeedIndex: audits["speed-index"].displayValue,
    };

    console.log("\n🚀 Lighthouse Audit Summary");
    console.log("===========================");
    console.table(scores);

    console.log("\n⏱️  Key Metrics");
    console.table(metrics);

    // Simple pass/fail logic
    if (scores.Performance < 90) {
      console.warn(
        "\n⚠️  Performance is below 90. Check for heavy dependencies or unoptimized images.",
      );
    } else {
      console.log("\n✅ Performance looks great!");
    }
  } catch (error) {
    console.error(
      "Error reading lighthouse.json. Make sure to run 'bun run lighthouse' first.",
    );
  }
}

summarize();
