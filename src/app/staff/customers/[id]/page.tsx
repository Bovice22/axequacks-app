import CustomerDetail from "./CustomerDetail";
import { requireStaff } from "@/lib/staffAuth";

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  await requireStaff();

  return (
    <div className="p-6">
      <CustomerDetail customerId={params.id} />
    </div>
  );
}
