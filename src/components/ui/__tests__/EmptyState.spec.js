import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../EmptyState.vue'

describe('EmptyState', () => {
  it('renders default title when none passed', () => {
    const w = mount(EmptyState)
    expect(w.text()).toContain('Nothing here yet')
  })

  it('overrides title and message via props', () => {
    const w = mount(EmptyState, {
      props: { title: 'No tickets', message: 'All caught up' },
    })
    expect(w.text()).toContain('No tickets')
    expect(w.text()).toContain('All caught up')
  })

  it('renders a custom icon class', () => {
    const w = mount(EmptyState, { props: { icon: 'ri-checkbox-circle-line' } })
    expect(w.find('.ri-checkbox-circle-line').exists()).toBe(true)
  })

  it('renders default slot content (e.g. a CTA button)', () => {
    const w = mount(EmptyState, {
      slots: { default: '<button class="cta">Create</button>' },
    })
    expect(w.find('button.cta').exists()).toBe(true)
  })
})
