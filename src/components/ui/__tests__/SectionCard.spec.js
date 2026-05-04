import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SectionCard from '../SectionCard.vue'

describe('SectionCard', () => {
  it('renders title and subtitle in the header', () => {
    const w = mount(SectionCard, {
      props: { title: 'Stock', subtitle: '12 items' },
    })
    expect(w.text()).toContain('Stock')
    expect(w.text()).toContain('12 items')
  })

  it('renders default slot inside card-body when noBody=false', () => {
    const w = mount(SectionCard, {
      props: { title: 'Stock' },
      slots: { default: '<p class="content">hello</p>' },
    })
    expect(w.find('.card-body .content').exists()).toBe(true)
  })

  it('skips card-body wrapper when noBody=true', () => {
    const w = mount(SectionCard, {
      props: { title: 'Stock', noBody: true },
      slots: { default: '<table class="raw"></table>' },
    })
    // table renders as a direct child of the card, not nested inside .card-body
    expect(w.find('.card-body').exists()).toBe(false)
    expect(w.find('table.raw').exists()).toBe(true)
  })

  it('renders the actions slot in the header', () => {
    const w = mount(SectionCard, {
      props: { title: 'Stock' },
      slots: { actions: '<button class="hdr-btn">Refresh</button>' },
    })
    expect(w.find('button.hdr-btn').exists()).toBe(true)
  })
})
