import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createAktivitas,
  deleteAktivitas,
  listAktivitas,
  readAktivitas,
  updateAktivitas,
} from "../controllers/aktivitas.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listAktivitas);
router.post("/", createAktivitas);
router.get("/:id", readAktivitas);
router.patch("/:id", updateAktivitas);
router.delete("/:id", deleteAktivitas);
export default router;
