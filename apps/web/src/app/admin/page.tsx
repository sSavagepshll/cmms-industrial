import { AdminApp } from "@/components/admin/AdminApp";

export const metadata = { title: "Painel Administrativo" };

export default function AdminPage() {
  return (
    <div data-app="admin">
      <AdminApp />
    </div>
  );
}
