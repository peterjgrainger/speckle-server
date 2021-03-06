<template>
  <v-row>
    <v-col sm="12">
      <v-card v-if="$apollo.queries.stream.loading">
        <v-skeleton-loader type="article"></v-skeleton-loader>
      </v-card>
      <v-card v-else rounded="lg" class="pa-4 mb-4" elevation="0">
        <v-dialog v-model="dialogBranch" max-width="500">
          <new-branch-dialog
            :branch-names="branches.items.map((b) => b.name)"
            :stream-id="$route.params.streamId"
            @close="closeBranchDialog"
          />
        </v-dialog>
        <v-card-title>
          <v-icon class="mr-2">mdi-source-branch</v-icon>
          Branches

          <v-spacer />
          <v-btn
            v-if="userRole === 'contributor' || userRole === 'owner'"
            plain
            color="primary"
            text
            class="px-0"
            small
            @click="dialogBranch = true"
          >
            <v-icon small class="mr-2 float-left">mdi-plus-circle-outline</v-icon>
            New branch
          </v-btn>
        </v-card-title>
        <v-breadcrumbs :items="breadcrumbs" divider="/"></v-breadcrumbs>
        <v-card-text>
          <i>
            A branch represents an independent line of data. You can think of them as an independent
            directory, staging area and project history.
          </i>
        </v-card-text>
      </v-card>

      <v-card v-if="!$apollo.queries.stream.loading" class="mt-5 pa-4" elevation="0" rounded="lg">
        <v-subheader class="text-uppercase">Branches ({{ branches.items.length }})</v-subheader>
        <v-card-text>
          <v-list two-line color="transparent">
            <template v-for="item in branches.items">
              <v-list-item
                :key="item.id"
                :to="`/streams/${$route.params.streamId}/branches/${encodeURIComponent(item.name)}`"
              >
                <v-list-item-content>
                  <v-list-item-title>
                    <b>{{ item.name }}</b>
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    {{ item.description ? item.description : 'no description provided' }}
                  </v-list-item-subtitle>
                </v-list-item-content>
                <v-list-item-action>
                  <v-chip small>
                    {{ item.commits.totalCount }}
                    commits
                  </v-chip>
                </v-list-item-action>
              </v-list-item>
            </template>
          </v-list>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
<script>
import NewBranchDialog from '../components/dialogs/BranchNewDialog'
import streamBranchesQuery from '../graphql/streamBranches.gql'
import gql from 'graphql-tag'

export default {
  name: 'StreamMain',
  components: {
    NewBranchDialog
  },
  props: {
    userRole: {
      type: String,
      default: null
    }
  },
  data() {
    return {
      dialogBranch: false
    }
  },
  apollo: {
    stream: {
      query: streamBranchesQuery,
      variables() {
        return {
          id: this.$route.params.streamId
        }
      },
      update(data) {
        return data.stream
      }
    },
    $subscribe: {
      branchCreated: {
        query: gql`
          subscription($streamId: String!) {
            branchCreated(streamId: $streamId)
          }
        `,
        variables() {
          return {
            streamId: this.$route.params.streamId
          }
        },
        result() {
          this.$apollo.queries.stream.refetch()
        },
        skip() {
          return !this.loggedIn
        }
      },
      branchDeleted: {
        query: gql`
          subscription($streamId: String!) {
            branchDeleted(streamId: $streamId)
          }
        `,
        variables() {
          return {
            streamId: this.$route.params.streamId
          }
        },
        result() {
          this.$apollo.queries.stream.refetch()
        },
        skip() {
          return !this.loggedIn
        }
      }
    }
  },
  computed: {
    branches() {
      return this.stream.branches
    },
    breadcrumbs() {
      return [
        {
          text: this.stream.name,
          disabled: false,
          exact: true,
          to: '/streams/' + this.stream.id
        },
        {
          text: 'branches',
          disabled: true,
          exact: true,
          to: '/streams/' + this.stream.id + '/branches/'
        }
      ]
    },
    loggedIn() {
      return localStorage.getItem('uuid') !== null
    }
  },
  mounted() {
    this.$apollo.queries.stream.refetch()
  },
  methods: {
    closeBranchDialog() {
      this.dialogBranch = false
      this.$apollo.queries.stream.refetch()
    }
  }
}
</script>
