// pages/api/test-simpro.ts - Direct SimPro API test
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startTime = Date.now();

  try {
    console.log("🧪 [SimPro Test] Testing SimPro API connection...");

    // Check environment variables
    const baseUrl = process.env.SIMPRO_BASE_URL;
    const accessToken = process.env.SIMPRO_ACCESS_TOKEN;
    const companyId = process.env.SIMPRO_COMPANY_ID;

    console.log("📋 [SimPro Test] Environment check:", {
      hasBaseUrl: !!baseUrl,
      baseUrl: baseUrl,
      hasAccessToken: !!accessToken,
      accessTokenPreview: accessToken
        ? `${accessToken.substring(0, 10)}...`
        : "missing",
      hasCompanyId: !!companyId,
      companyId: companyId,
    });

    if (!baseUrl || !accessToken || !companyId) {
      throw new Error("Missing SimPro environment variables");
    }

    // Clean the base URL
    const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
    const apiUrl = `${cleanBaseUrl}/api/v1.0/companies`;

    console.log("🌐 [SimPro Test] Making request to:", apiUrl);

    // Make direct API call
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const responseTime = Date.now() - startTime;

    console.log("📡 [SimPro Test] Response status:", response.status);
    console.log(
      "📡 [SimPro Test] Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ [SimPro Test] Error response:", errorText);

      throw new Error(
        `SimPro API error ${response.status}: ${response.statusText}. Response: ${errorText}`
      );
    }

    const data = await response.json();
    console.log(
      "✅ [SimPro Test] Success! Found companies:",
      data?.length || 0
    );

    res.status(200).json({
      success: true,
      message: "SimPro API connection successful",
      responseTime: `${responseTime}ms`,
      companiesFound: data?.length || 0,
      apiUrl: apiUrl,
      environment: {
        baseUrl: baseUrl,
        companyId: companyId,
        tokenLength: accessToken?.length || 0,
      },
      firstCompany: data?.[0]
        ? {
            id: data[0].ID,
            name: data[0].Name,
          }
        : null,
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error("❌ [SimPro Test] Failed:", error);

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      responseTime: `${responseTime}ms`,
      environment: {
        hasBaseUrl: !!process.env.SIMPRO_BASE_URL,
        hasAccessToken: !!process.env.SIMPRO_ACCESS_TOKEN,
        hasCompanyId: !!process.env.SIMPRO_COMPANY_ID,
        baseUrl: process.env.SIMPRO_BASE_URL,
        companyId: process.env.SIMPRO_COMPANY_ID,
      },
    });
  }
}
