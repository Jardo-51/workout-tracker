<template>
  <v-bottom-navigation grow>
    <v-btn to="/">
      <v-icon icon="$home" />
      <span>Home</span>
    </v-btn>

    <v-btn to="/settings">
      <v-icon icon="$cog" />
      <span>Settings</span>
    </v-btn>
  </v-bottom-navigation>
</template>

<style scoped>
/* Reserve the iOS home-indicator inset below the nav buttons so the home
   indicator doesn't overlap them in standalone mode. */
.v-bottom-navigation {
  height: auto !important;
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
