/*
 * Copyright (C) 2017 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import React from 'react'
import {arrayOf, bool, func, shape, string} from 'prop-types'
import Select from '@instructure/ui-core/lib/components/Select'
import ScreenReaderContent from '@instructure/ui-a11y/lib/components/ScreenReaderContent'
import I18n from 'i18n!gradezilla'

function renderItem(item, selectedItemId, disabled) {
  return (
    <option disabled={disabled && selectedItemId !== item.id} key={item.id} value={item.id}>
      {item.name}
    </option>
  )
}

function renderItemAndChildren(item, selectedItemId, disabled) {
  return (
    <optgroup label={item.name} key={`group_${item.id}`}>
      {item.children.map(child => renderItem(child, selectedItemId, disabled))}
    </optgroup>
  )
}

class GradebookFilter extends React.Component {
  static propTypes = {
    items: arrayOf(
      shape({
        /* groups can only ever be a single level deep */
        children: arrayOf(
          shape({
            id: string.isRequired,
            name: string.isRequired
          })
        ),
        id: string.isRequired,
        name: string.isRequired
      })
    ).isRequired,
    onSelect: func.isRequired,
    selectedItemId: string.isRequired,
    filterLabel: string,
    allItemsLabel: string,
    disabled: bool
  }

  static defaultProps = {
    disabled: false,
    filterLabel: I18n.t('Item Filter'),
    allItemsLabel: I18n.t('All Items')
  }

  onChange = event => {
    if (!this.props.disabled) {
      this.props.onSelect(event.target.value)
    }
  }

  render() {
    const {disabled, selectedItemId} = this.props
    const allItemsDisabled = disabled && selectedItemId !== '0'

    return (
      <Select
        inline
        label={<ScreenReaderContent>{this.props.filterLabel}</ScreenReaderContent>}
        onChange={this.onChange}
        value={this.props.selectedItemId}
      >
        <option disabled={allItemsDisabled} key="0" value="0">
          {this.props.allItemsLabel}
        </option>

        {this.props.items.map(item => {
          const renderFn = item.children ? renderItemAndChildren : renderItem
          return renderFn(item, selectedItemId, disabled)
        })}
      </Select>
    )
  }
}

export default GradebookFilter
