<!-- src/layouts/AuthLayout.vue -->
<template>
  <div class="account-pages authentication-bg">
    <div class="container">
      <div class="row justify-content-center">
        <div class="col-12">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-pages {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}
</style>
