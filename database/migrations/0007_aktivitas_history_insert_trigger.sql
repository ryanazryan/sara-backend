CREATE TRIGGER trg_aktivitas_hist_insert
AFTER INSERT ON Aktivitas
FOR EACH ROW
INSERT INTO aktivitas_history
  (idPengguna, idAktivitas, eventType, oldStatus, newStatus, changes, occurredAt)
VALUES
  (NEW.idPengguna, NEW.idAktivitas, 'CREATED', NULL, NEW.status,
   JSON_OBJECT('after', JSON_OBJECT(
     'namaAktivitas', NEW.namaAktivitas,
     'idKegiatan', NEW.idKegiatan,
     'waktuMulai', NEW.waktuMulai,
     'waktuSelesai', NEW.waktuSelesai,
     'kategori', NEW.kategori,
     'prioritas', NEW.prioritas,
     'lokasi', NEW.lokasi,
     'status', NEW.status
   )), UTC_TIMESTAMP(6));
