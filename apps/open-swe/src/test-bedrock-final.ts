/**
 * Test script to verify Bedrock access - Final test with working models
 * Run with: npx tsx apps/open-swe/src/test-bedrock-final.ts
 */

import { BedrockChat } from "@langchain/community/chat_models/bedrock";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const region = process.env.AWS_REGION || "us-east-1";
const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

// Test models - Known working and potential models
const testModels = [
  "us.anthropic.claude-3-5-haiku-20241022-v1:0", // Known working
  "us.anthropic.claude-3-5-sonnet-20240620-v1:0", // Try Sonnet
];

async function testBedrockModel(modelId: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧪 Testing model: ${modelId}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const config: any = {
      model: modelId,
      region: region,
      maxTokens: 50,
      temperature: 0.7,
    };

    // Configure bearer token if available
    if (bearerToken) {
      console.log("✅ Using Bearer Token authentication");
      config.customFetchFunction = async (url: string, init?: RequestInit): Promise<Response> => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${bearerToken}`);
        headers.delete("X-Amz-Security-Token");
        headers.delete("X-Amz-Date");
        headers.delete("X-Amz-Signature");
        
        return fetch(url, {
          ...init,
          headers: headers,
        });
      };
      config.credentials = undefined;
    } else {
      console.log("ℹ️  Using IAM Role authentication (no bearer token found)");
    }

    console.log(`📍 Region: ${region}`);
    console.log(`🔧 Initializing BedrockChat...\n`);

    const model = new BedrockChat(config);

    console.log("✅ Model initialized successfully");
    console.log("📤 Sending test message...\n");

    const testMessage = "Say 'OK' if you can read this message.";
    const response = await model.invoke(testMessage);

    console.log("✅ SUCCESS! Model responded:");
    console.log(`📥 Response: ${response.content}\n`);
    console.log(`✅ Model ${modelId} is working correctly!\n`);

    return { success: true, modelId };
  } catch (error: any) {
    console.log("❌ ERROR:");
    console.log(`   ${error.message}\n`);

    return { success: false, modelId, error: error.message };
  }
}

async function runTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 BEDROCK ACCESS TEST - Final Verification");
  console.log("=".repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`   Region: ${region}`);
  console.log(`   Bearer Token: ${bearerToken ? "✅ Set" : "❌ Not set (using IAM Role)"}`);
  console.log(`   Test Models: ${testModels.length}\n`);

  let successCount = 0;
  let failCount = 0;
  const workingModels: string[] = [];

  for (const modelId of testModels) {
    const result = await testBedrockModel(modelId);
    if (result.success) {
      successCount++;
      workingModels.push(result.modelId);
    } else {
      failCount++;
    }
    
    // Wait a bit between tests
    if (testModels.indexOf(modelId) < testModels.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📋 Total: ${testModels.length}\n`);

  if (successCount > 0) {
    console.log("✅ Bedrock is working! You can use these models:\n");
    console.log("🎯 WORKING MODELS:");
    workingModels.forEach((model, index) => {
      console.log(`   ${index + 1}. ${model}`);
    });
    console.log("\n💡 RECOMMENDATION:");
    console.log(`   Use: ${workingModels[0]}`);
    console.log("   This is the model that works with your account.\n");
  } else {
    console.log("❌ All tests failed. Check the errors above.\n");
  }
}

runTests().catch(console.error);
