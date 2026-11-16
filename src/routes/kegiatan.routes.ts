import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  createKegiatan,
  deleteKegiatan,
  listKegiatan,
  readKegiatan,
  updateKegiatan,
} from "../controllers/kegiatan.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listKegiatan);
router.post("/", createKegiatan);
router.get("/:id", readKegiatan);
router.patch("/:id", updateKegiatan);
router.delete("/:id", deleteKegiatan);
export default router;
