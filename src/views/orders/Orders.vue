<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import http from "../../api/http";
import { listOrders } from "../../api/orders";

const router = useRouter();

const loading = ref(false);
const outlets = ref([]);

const filters = ref({
  outlet_id: "",
  status: "all",
  order_type: "",
  q: "",
});

const rows = ref([]);

const modalTitle = ref("Message");
const modalBody = ref("");
let modalInstance = null;

function showModal(title, body) {
  modalTitle.value = title;
  modalBody.value = body;

  const el = document.getElementById("centermodal");
  if (!el) return;
  if (!modalInstance) modalInstance = window.bootstrap ? new window.bootstrap.Modal(el) : null;
  modalInstance?.show();
}

async function loadOutlets() {
  const data = await http.get("/system/outlets").then((r) => r.data);
  outlets.value = Array.isArray(data) ? data : [];
}

async function load() {
  loading.value = true;
  try {
    const params = {
      limit: 200,
      status: filters.value.status,
    };

    if (filters.value.outlet_id) params.outlet_id = Number(filters.value.outlet_id);
    if (filters.value.order_type) params.order_type = filters.value.order_type;
    if (filters.value.q) params.q = filters.value.q;

    rows.value = await listOrders(params);
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to load orders";
    showModal("Error", msg);
  } finally {
    loading.value = false;
  }
}

function openPos(orderId) {
  router.push({ name: "pos-order", params: { id: orderId } });
}

onMounted(async () => {
  try {
    await loadOutlets();
    await load();
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "Failed to initialize";
    showModal("Error", msg);
  }
});
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between" style="zoom: 80%;">
      <h4 class="page-title mb-0">Orders</h4>

      <router-link class="btn btn-primary" to="/pos/new-order">
        <i class="uil-plus me-1"></i> New Order
      </router-link>
    </div>

    <div class="card" style="zoom: 80%;">
      <div class="card-body">
        <div class="row g-2 align-items-end mb-3">
          <div class="col-md-3">
            <label class="form-label">Outlet</label>
            <select class="form-select" v-model="filters.outlet_id" @change="load">
              <option value="">All outlets</option>
              <option v-for="o in outlets" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Status</label>
            <select class="form-select" v-model="filters.status" @change="load">
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="held">Held</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div class="col-md-2">
            <label class="form-label">Type</label>
            <select class="form-select" v-model="filters.order_type" @change="load">
              <option value="">All</option>
              <option value="DINE_IN">Dine In</option>
              <option value="TAKEAWAY">Takeaway</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>

          <div class="col-md-3">
            <label class="form-label">Search</label>
            <input class="form-control" v-model="filters.q" placeholder="Order no / phone / name" @keyup.enter="load" />
          </div>

          <div class="col-md-2 d-flex gap-2">
            <button class="btn btn-soft-primary w-100" :disabled="loading" @click="load">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Refresh
            </button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="table table-centered table-nowrap mb-0">
            <thead class="table-light">
              <tr>
                <th>Order No</th>
                <th>Type</th>
                <th>Status</th>
                <th>Table</th>
                <th class="text-end">Total</th>
                <th>Opened</th>
                <th class="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && rows.length === 0">
                <td colspan="7" class="text-muted text-center py-4">No orders found</td>
              </tr>

              <tr v-for="r in rows" :key="r.id">
                <td class="fw-semibold">{{ r.order_no }}</td>
                <td>{{ r.order_type }}</td>
                <td>
                  <span
                    class="badge"
                    :class="{
                      'bg-success': r.status === 'PAID',
                      'bg-warning': r.status === 'HELD',
                      'bg-primary': r.status === 'OPEN',
                      'bg-danger': r.status === 'CANCELLED'
                    }"
                  >
                    {{ r.status }}
                  </span>
                </td>
                <td>{{ r.table_no || "-" }}</td>
                <td class="text-end">{{ r.total }}</td>
                <td>{{ new Date(r.opened_at).toLocaleString() }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-soft-primary" @click="openPos(r.id)">
                    Open
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <!-- Center Modal -->
    <div class="modal fade" id="centermodal" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title" id="myCenterModalLabel">{{ modalTitle }}</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-hidden="true"></button>
          </div>
          <div class="modal-body">
            {{ modalBody }}
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
