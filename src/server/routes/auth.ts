import express from "express";
import { getMe, getUsers, changePassword, changeUsername, logout } from "../controllers/auth.js";
import {
  registerWithEmail,
  loginWithEmailOrUsername,
  googleLoginVerified,
  forgotPassword,
  resetPassword,
  discordStart,
  discordCallback,
  discordExchange
} from "../controllers/authExtra.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", registerWithEmail);
router.post("/login", loginWithEmailOrUsername);
router.post("/google", googleLoginVerified);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/discord/start", discordStart);
router.get("/discord/callback", discordCallback);
router.post("/discord/exchange", discordExchange);
router.post("/logout", logout);
router.get("/me", requireAuth, getMe);
router.get("/users", requireAuth, getUsers);
router.put("/password", requireAuth, changePassword);
router.put("/username", requireAuth, changeUsername);

export default router;
