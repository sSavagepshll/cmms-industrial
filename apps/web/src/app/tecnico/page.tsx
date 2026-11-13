import { TecnicoApp } from "@/components/tecnico/TecnicoApp";

export const metadata = { title: "Kanban da Manutenção" };

export default function TecnicoPage() {
  return (
    <div data-app="kiosk">
      <TecnicoApp />
    </div>
  );
}
