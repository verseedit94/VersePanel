import express from "express";
import { readJSON } from "../services/db.js";

const router = express.Router();
import authRoutes from "./auth.js";
import serverRoutes from "./servers.js";
import systemRoutes from "./system.js";
import apiKeyRoutes from "./api-keys.js";
import nodeRoutes from "./nodes.js";
import subdomainRoutes from "./subdomains.js";
import aiBotRoutes from "./aibot.js";
import { siteRouter, billingRouter } from "./site.js";
import adminConfigRoutes from "./adminConfig.js";
import eggRoutes from "./eggs.js";
import nodeEnrollRoutes from "./nodeEnroll.js";
import activityRoutes from "./activity.js";
import { activityMiddleware } from "../services/activity.js";
import { isMailConfigured } from "../services/mailer.js";
import { getServerHost } from "../services/domain.js";

router.use("/auth", authRoutes);
router.use("/servers", serverRoutes);
router.use("/system", systemRoutes);
router.use("/admin/api-keys", apiKeyRoutes);
router.use("/nodes/enroll", nodeEnrollRoutes); // public (token in URL)
router.use("/nodes", nodeRoutes);
router.use("/subdomains", subdomainRoutes);
router.use("/admin/config", activityMiddleware("plain", "settings"), adminConfigRoutes);
router.use("/admin/aibot", aiBotRoutes);
router.use("/site", siteRouter);
router.use("/billing", billingRouter);
router.use("/eggs", eggRoutes);
router.use("/activity", activityRoutes);

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    panel: "Verse Panel",
    version: "3.0.0",
    timestamp: Date.now(),
    nodeEnv: process.env.NODE_ENV || "development"
  });
});

router.get("/settings", async (req, res) => {
  const settings = await readJSON("settings.json") || {};
  res.json({ 
    version: "3.0.0",
    panelName: settings.panelName || "Verse Panel",
    panelLogo: settings.panelLogo || "",
    panelBackgroundImage: settings.panelBackgroundImage || "",
    panelBackgroundBlur: settings.panelBackgroundBlur !== undefined ? settings.panelBackgroundBlur : 10,
    enablePlayit: settings.enablePlayit !== undefined ? settings.enablePlayit : false,
    enableTutorial: settings.enableTutorial !== undefined ? settings.enableTutorial : true,
    enableLoginAnimation: settings.enableLoginAnimation !== undefined ? settings.enableLoginAnimation : true,
    enableRegistration: settings.enableRegistration !== undefined ? settings.enableRegistration : true,
    theme: settings.theme || "red",
    enableGoogleLogin: settings.enableGoogleLogin !== undefined ? settings.enableGoogleLogin : false,
    firebaseApiKey: settings.firebaseApiKey || "",
    firebaseAuthDomain: settings.firebaseAuthDomain || "",
    firebaseProjectId: settings.firebaseProjectId || "",
    firebaseStorageBucket: settings.firebaseStorageBucket || "",
    firebaseMessagingSenderId: settings.firebaseMessagingSenderId || "",
    firebaseAppId: settings.firebaseAppId || "",
    discordEnabled: !!(settings.discordEnabled && settings.discordClientId && settings.discordClientSecret),
    mailEnabled: await isMailConfigured(),
    panelDomain: settings.panelDomain && settings.domainVerified ? settings.panelDomain : "",
    accessMode: settings.accessMode || (settings.panelDomain && settings.domainVerified ? "domain" : "local"),
    panelHost: await getServerHost(),
    panelScheme: settings.panelScheme === "http" ? "http" : "https",
    defaultRuntime: settings.defaultRuntime || process.env.DEFAULT_RUNTIME || "docker",
    isDevPanel: (process.env.PANEL_TYPE === "dev" || process.env.PORT === "3000") && !process.env.FORCE_MAIN_PANEL,
    panelPort: process.env.PORT || "6767"
  });
});

export default router;
