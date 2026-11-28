import "dotenv/config";
import { registerIntelligenceScheduler } from "../../modules/intelligence/infra/scheduler/intelligence-scheduler.js";
import { registerAppointmentRemindersScheduler } from "../../modules/whatsapp/infra/scheduler/appointment-reminders-scheduler.js";
import { app } from "./App.js";

const PORT = Number(process.env.PORT || 3908);

export async function start() {
  try {
    registerIntelligenceScheduler(app);
    registerAppointmentRemindersScheduler(app);
    await app.listen({
      port: PORT,
      host: "0.0.0.0",
    });

    console.log(`Server is running on port ${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();