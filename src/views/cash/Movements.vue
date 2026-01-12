<script setup>
import { ref, onMounted } from "vue";
import DefaultLayout from "../../layouts/DefaultLayout.vue";
import { useToast } from "vue-toastification";
import { listAllMovements } from "../../api/cash";

const toast = useToast();
const loading = ref(true);

const outletId = ref("");
const shiftId = ref("");
const movementType = ref("");
const items = ref([]);

async function load() {
  loading.value = true;
  try {
    items.value = await listAllMovements({
      outlet_id: outletId.value || undefined,
      shift_id: shiftId.value || undefined,
      movement_type: movementType.value || undefined,
      limit: 200,
    });
  } catch (e) {
    toast.error(e?.response?.data?.detail || "Failed to load movements");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <DefaultLayout>
    <div class="page-title-box d-flex align-items-center justify-content-between">
      <h4 class="page-title mb-0">Cash Movements</h4>
      <div class="d-flex gap-2 align-items-center">
        <input v-model="outletId" class="form-control" placeholder="Outlet ID" style="width: 140px" />
        <input v-model="shiftId" class="form-control" placeholder="Shift ID" style="width: 140px" />
        <select v-model="movementType" class="form-select" style="width: 170px">
          <option value="">All Types</option>
          <option value="PAID_IN">PAID_IN</option>
          <option value="PAID_OUT">PAID_OUT</option>
          <option value="DROP">DROP</option>
          <option value="CORRECTION">CORRECTION</option>
        </select>
        <button class="btn btn-outline-secondary" :disabled="loading" @click="load">Load</button>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body">Loading...</div></div>

    <div v-else class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-sm table-centered mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Shift</th>
                <th>Outlet</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in items" :key="m.id">
                <td>{{ m.occurred_at }}</td>
                <td>{{ m.shift_id }}</td>
                <td>{{ m.outlet_id }}</td>
                <td><b>{{ m.movement_type }}</b></td>
                <td>{{ m.amount }}</td>
                <td>{{ m.reason || "-" }}</td>
                <td>{{ m.performed_by?.username || m.performed_by?.email || m.performed_by_user_id }}</td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="7" class="text-center text-muted py-3">No movements found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>
