/*
 * Copyright (C) 2015 - present Instructure, Inc.
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

import I18n from 'i18n!new_nav'
import React from 'react'
import {bool, arrayOf, shape, string} from 'prop-types'
import View from '@instructure/ui-layout/lib/components/View'
import Heading from '@instructure/ui-elements/lib/components/Heading'
import Button from '@instructure/ui-buttons/lib/components/Button'
import List, {ListItem} from '@instructure/ui-elements/lib/components/List'
import Spinner from '@instructure/ui-elements/lib/components/Spinner'
import Text from '@instructure/ui-elements/lib/components/Text'

import CourseLink from './CourseLink'

export default function CoursesTray({courses, hasLoaded}) {
  return (
    <View as="div" padding="medium">
      <Heading level="h3" as="h2">{I18n.t('Courses')}</Heading>
      <hr role="presentation"/>
      <List variant="unstyled" itemSpacing="x-small" >
        {hasLoaded ? (
          courses.map(course =>
            <ListItem key={course.id} >
              <CourseLink course={course} />
              {course.enrollment_term_id > 1 &&
                <Text as="div" size="x-small" weight="light" lineHeight="fit">{course.term.name}</Text>
              }
            </ListItem>
          ).concat([
            <ListItem key="hr"><hr role="presentation"/></ListItem>,
            <ListItem key="all">
              <Button
                variant="link"
                href="/courses"
                fluidWidth
                theme={{mediumPadding: '0'}}
              >
                {I18n.t('All Courses')}
              </Button>
            </ListItem>
          ])
        ) : (
          <ListItem>
            <Spinner size="small" title={I18n.t('Loading')} />
          </ListItem>
        )}
      </List>
      <br />
        <View as="div">
          {I18n.t(
            'Welcome to your courses! To customize the list of courses,  click on the "All Courses" link and star the courses to display.'
          )}
        </View>
    </View>
  )
}

CoursesTray.propTypes = {
  courses: arrayOf(shape({
    id: string.isRequired,
    name: string.isRequired
  })).isRequired,
  hasLoaded: bool.isRequired
}

CoursesTray.defaultProps = {
  courses: []
}
