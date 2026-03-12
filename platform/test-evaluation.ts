/**
 * Test script for 8th layer self-evaluation
 * Run: bun run test-evaluation.ts
 */

import { PlatformClient } from "./src/sdk/client"

async function testEvaluation() {
  const sdk = new PlatformClient({
    baseUrl: "http://localhost:3100",
  })

  try {
    console.log("🚀 Testing 8th Layer Self-Evaluation\n")
    console.log("1️⃣  Creating new session...")
    const session = await sdk.createSession()
    console.log(`✅ Session created: ${session.id}\n`)

    // Test query 1: Simple
    console.log("2️⃣  Sending test query: 'What is REST API?'")
    const response1 = await sdk.prompt(session.id, {
      content: "What is REST API?",
    })

    displayResponse("Query 1: REST API", response1)

    // Test query 2: Complex
    console.log("\n3️⃣  Sending test query: 'Explain the difference between REST and GraphQL APIs'")
    const response2 = await sdk.prompt(session.id, {
      content: "Explain the difference between REST and GraphQL APIs",
    })

    displayResponse("Query 2: REST vs GraphQL", response2)

    console.log("\n✨ Test completed successfully!\n")
  } catch (e) {
    console.error("❌ Error:", e)
    process.exit(1)
  }
}

function displayResponse(title: string, response: any) {
  console.log(`\n${"═".repeat(70)}`)
  console.log(`📝 ${title}`)
  console.log(`${"═".repeat(70)}`)

  const parts = response.parts ?? []
  let hasEvaluation = false

  for (const part of parts) {
    if (part.type === "text") {
      console.log(`\n💬 Response:\n${part.text}`)
    } else if (part.type === "evaluation") {
      hasEvaluation = true
      const eval_ = part.evaluation
      console.log(`\n${"╔".padEnd(72, "═")}╗`)
      console.log(`║ ${"🤖 SELF-EVALUATION REPORT".padEnd(68)} ║`)
      console.log(`${"╚".padEnd(72, "═")}╝`)

      console.log(`\n📊 Metrics:`)
      const confPct = Math.round(eval_.confidenceScore * 100)
      const compPct = Math.round(eval_.completenessScore * 100)
      const cohPct = Math.round(eval_.coherenceScore * 100)
      const relPct = Math.round(eval_.relevanceScore * 100)

      const confIndicator = confPct >= 80 ? "🟢" : confPct >= 60 ? "🟡" : "🔴"
      console.log(`  • Confidence:        ${confPct.toString().padEnd(3)} % ${confIndicator}`)
      console.log(`  • Quality:           ${eval_.quality.toUpperCase()}`)
      console.log(`  • Completeness:      ${compPct.toString().padEnd(3)} %`)
      console.log(`  • Coherence:         ${cohPct.toString().padEnd(3)} %`)
      console.log(`  • Relevance:         ${relPct.toString().padEnd(3)} %`)

      if (eval_.toolsUsed && eval_.toolsUsed.length > 0) {
        console.log(`\n🔧 Tools Used:`)
        for (const tool of eval_.toolsUsed.slice(0, 5)) {
          console.log(`  • ${tool}`)
        }
      }

      if (eval_.concerns && eval_.concerns.length > 0) {
        console.log(`\n⚠️  Concerns:`)
        for (const concern of eval_.concerns.slice(0, 3)) {
          console.log(`  • ${concern}`)
        }
      }

      if (eval_.suggestedImprovements && eval_.suggestedImprovements.length > 0) {
        console.log(`\n💡 Suggested Improvements:`)
        for (const improvement of eval_.suggestedImprovements.slice(0, 3)) {
          console.log(`  • ${improvement}`)
        }
      }

      console.log(`\n✅ Learned: ${eval_.learned ? "Yes" : "No"}`)
    }
  }

  if (!hasEvaluation) {
    console.log("\n⚠️  WARNING: No evaluation found in response!")
    console.log("Response parts:", JSON.stringify(parts, null, 2))
  }
}

testEvaluation()
