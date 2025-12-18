/**
 * Test script to verify Bedrock access with Amazon Nova models
 * Run with: npx tsx apps/open-swe/src/test-bedrock.ts
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

// Test models - Amazon Nova models
const testModels = [
  "amazon.nova-premier-v1:0",
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
  "amazon.nova-micro-v1:0",
  "us.amazon.nova-premier-v1:0",
  "us.amazon.nova-pro-v1:0",
  "us.amazon.nova-lite-v1:0",
  "us.amazon.nova-micro-v1:0",
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

    if (error.message.includes("channel program")) {
      console.log("⚠️  ISSUE: Your account is a 'channel program account'");
      console.log("   Contact your AWS Solution Provider\n");
    } else if (error.message.includes("case details") || error.message.includes("use case")) {
      console.log("⚠️  ISSUE: Use case details required");
      console.log("   Go to Bedrock console and submit use case details\n");
    } else if (error.message.includes("not available") || error.message.includes("not found")) {
      console.log("⚠️  ISSUE: Model not available or access not granted");
      console.log("   Request access in Bedrock console\n");
    } else if (error.message.includes("inference profile") || error.message.includes("on-demand")) {
      console.log("⚠️  ISSUE: Model requires inference profile");
      console.log("   This model may need inference profile configuration\n");
    } else if (error.message.includes("401") || error.message.includes("Unauthorized")) {
      console.log("⚠️  ISSUE: Authentication failed");
      if (bearerToken) {
        console.log("   Bearer token may be expired or invalid");
        console.log("   Check AWS_BEARER_TOKEN_BEDROCK in .env\n");
      } else {
        console.log("   IAM Role may not have proper permissions\n");
      }
    } else {
      console.log("⚠️  Check:");
      console.log("   - Bearer token is valid (if using)");
      console.log("   - IAM Role has Bedrock permissions");
      console.log("   - Model access is granted in Bedrock console\n");
    }

    return { success: false, modelId, error: error.message };
  }
}

async function runTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 BEDROCK ACCESS TEST - Amazon Nova Models");
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
    console.log("✅ Bedrock is working! You can use Amazon Nova models.\n");
    console.log("🎯 WORKING MODELS:");
    workingModels.forEach((model, index) => {
      console.log(`   ${index + 1}. ${model}`);
    });
    console.log("\n💡 Tip: Update your model configuration to use the working models.\n");
  } else {
    console.log("❌ All tests failed. Check the errors above.\n");
    console.log("💡 Try:");
    console.log("   - Requesting model access in Bedrock console");
    console.log("   - Checking IAM permissions");
    console.log("   - Verifying bearer token (if using)\n");
  }
}

runTests().catch(console.error);
